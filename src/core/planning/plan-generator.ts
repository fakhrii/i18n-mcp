import * as path from "node:path";
import type {
  CodeChange,
  GenerateI18nPlanInput,
  I18nPlan,
  PlanError,
  PlanSummary,
  PlanWarning,
  SourceChangePlan,
  TranslationPlan,
} from "../../models/plan.js";
import type { DetectedString } from "../../models/scanner.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { scanHardcodedTexts } from "../scanner/scanner.js";
import { resolveSuggestedNamespace } from "../namespace/namespace-resolver.js";
import { generateSemanticKey } from "../keys/key-generator.js";
import {
  loadExistingTranslations,
  resolveExistingTranslation,
} from "./existing-key-resolver.js";
import { resolveKeyCollision } from "./key-collision-resolver.js";
import {
  analyzeFileTranslationContext,
  buildReplacementExpression,
  determineRequiredCodeChanges,
  planSourceChange,
  type FileTranslationContext,
} from "./source-change-planner.js";
import {
  getLocaleFilePath,
  planTargetLocales,
  type LocalePlanningContext,
} from "./locale-change-planner.js";
import {
  dirExists,
  listFiles,
  readJsonFile,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import { flattenNestedObject } from "../../utils/nested-json.js";
import { planI18nSetup } from "../setup/setup-planner.js";
import type { I18nSetupPlan } from "../../models/setup.js";
import { logger } from "../../utils/logger.js";

/**
 * Loads translations for target locales to identify already-translated vs missing keys.
 */
async function loadTargetLocaleTranslations(
  projectRoot: string,
  localeDirectory: string | null,
  targetLocales: string[]
): Promise<{
  translations: Map<string, Map<string, Map<string, string>>>;
  isSubdirStructure: boolean;
}> {
  const result = new Map<string, Map<string, Map<string, string>>>();
  let isSubdirStructure = true;

  if (!localeDirectory) {
    return { translations: result, isSubdirStructure };
  }

  const fullLocaleDir = path.join(projectRoot, localeDirectory);
  if (!(await dirExists(fullLocaleDir))) {
    return { translations: result, isSubdirStructure };
  }

  for (const locale of targetLocales) {
    const localeMap = new Map<string, Map<string, string>>();
    result.set(locale, localeMap);

    const localeSubdir = path.join(fullLocaleDir, locale);
    if (await dirExists(localeSubdir)) {
      isSubdirStructure = true;
      const files = await listFiles(localeSubdir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const ns = path.basename(f, ".json");
        const content = await readJsonFile<Record<string, unknown>>(
          path.join(localeSubdir, f)
        );
        if (!content) continue;
        const flat = flattenNestedObject(content);
        const nsMap = new Map<string, string>();
        for (const [k, v] of flat.entries()) {
          nsMap.set(k, v);
        }
        localeMap.set(ns, nsMap);
      }
    } else {
      isSubdirStructure = false;
      const singleFile = path.join(fullLocaleDir, `${locale}.json`);
      const content = await readJsonFile<Record<string, unknown>>(singleFile);
      if (content) {
        let hasNamespaces = false;
        for (const [k, v] of Object.entries(content)) {
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            hasNamespaces = true;
            const nsMap = localeMap.get(k) || new Map<string, string>();
            const nsFlat = flattenNestedObject(v as Record<string, unknown>);
            for (const [subK, subV] of nsFlat.entries()) {
              nsMap.set(subK, subV);
            }
            localeMap.set(k, nsMap);
          }
        }

        if (!hasNamespaces) {
          const ns = "common";
          const nsMap = localeMap.get(ns) || new Map<string, string>();
          const flat = flattenNestedObject(content);
          for (const [subK, subV] of flat.entries()) {
            nsMap.set(subK, subV);
          }
          localeMap.set(ns, nsMap);
        }
      }
    }
  }

  return { translations: result, isSubdirStructure };
}

/**
 * Generates a complete, deterministic, non-destructive i18n migration plan.
 */
export async function generateI18nPlan(
  input?: GenerateI18nPlanInput
): Promise<I18nPlan> {
  const projectRoot = path.resolve(input?.path || input?.projectPath || process.cwd());
  logger.info(`Generating i18n migration plan for ${projectRoot}`);

  // 1. Analyze project
  const analysis = await analyzeProject(projectRoot);

  // 2. Determine Locales
  const sourceLocale =
    input?.sourceLocale || analysis.i18n.sourceLocale || "en";
  const targetLocales =
    input?.targetLocales || analysis.i18n.targetLocales || [];

  // 3. Scan for hardcoded texts
  const confidenceThreshold = input?.confidenceThreshold ?? 0.7;
  const scanResult = await scanHardcodedTexts(projectRoot, {
    scope: input?.scope,
    include: input?.include,
    exclude: input?.exclude,
    onlyUserFacing: true,
    minConfidence: 0.0, // Scan all to classify properly into REPLACE vs REVIEW
  });

  // 4. Plan Setup if project has no i18n infrastructure or missing locale directory
  let setupPlan: I18nSetupPlan | undefined;
  let effectiveLocaleDir = analysis.i18n.localeDirectory;

  if (analysis.i18n.needsSetup || !effectiveLocaleDir) {
    setupPlan = await planI18nSetup(projectRoot, analysis, {
      sourceLocale,
      targetLocales,
    });
    effectiveLocaleDir = setupPlan.localeDirectory;
  }

  // 5. Load existing translations
  const existingSource = await loadExistingTranslations(
    projectRoot,
    effectiveLocaleDir,
    sourceLocale
  );

  const { translations: targetLocaleTranslations, isSubdirStructure } =
    await loadTargetLocaleTranslations(
      projectRoot,
      effectiveLocaleDir,
      targetLocales
    );

  const localeContext: LocalePlanningContext = {
    projectRoot,
    localeDirectory: effectiveLocaleDir,
    sourceLocale,
    targetLocales,
    isSubdirStructure,
    existingTargetTranslations: targetLocaleTranslations,
  };

  // 5. Track used keys and values per namespace to detect collisions
  const namespaceUsedKeys = new Map<string, Set<string>>();
  const namespaceKeyValues = new Map<string, Map<string, string>>();

  for (const [ns, map] of existingSource.byNamespace.entries()) {
    namespaceUsedKeys.set(ns, new Set(map.keys()));
    namespaceKeyValues.set(ns, new Map(map.entries()));
  }

  // Ensure 'common' is initialized
  if (!namespaceUsedKeys.has("common")) {
    namespaceUsedKeys.set("common", new Set());
    namespaceKeyValues.set("common", new Map());
  }

  // 6. Cache file contexts (imports, existing hooks)
  const fileContexts = new Map<string, FileTranslationContext>();
  const uniqueFiles = new Set(scanResult.items.map((i) => i.file));

  let primaryAccessPattern = "useTranslation";
  if (
    analysis.framework === "react-native" ||
    analysis.framework === "react" ||
    analysis.framework === "nextjs"
  ) {
    primaryAccessPattern = "useTranslation";
  } else if (analysis.accessPatterns.includes("useTranslation")) {
    primaryAccessPattern = "useTranslation";
  } else if (analysis.accessPatterns.includes("t")) {
    primaryAccessPattern = "useTranslation";
  } else if (analysis.accessPatterns.includes("i18n.t")) {
    primaryAccessPattern = "i18n.t";
  } else if (analysis.accessPatterns.length > 0) {
    primaryAccessPattern = analysis.accessPatterns[0]!;
  }

  for (const relFile of uniqueFiles) {
    const absFile = path.join(projectRoot, relFile);
    const content = (await readTextFile(absFile)) || "";
    const ctx = analyzeFileTranslationContext(content, primaryAccessPattern);
    ctx.filePath = toPosixPath(relFile);
    fileContexts.set(relFile, ctx);
  }

  // 7. Group detected strings by normalized text and context for deduplication
  // Key: normalizedText -> DetectedString[]
  const groupedByText = new Map<string, DetectedString[]>();
  for (const item of scanResult.items) {
    const key = item.text.trim();
    const list = groupedByText.get(key) || [];
    list.push(item);
    groupedByText.set(key, list);
  }

  const translations: TranslationPlan[] = [];
  const sourceChanges: SourceChangePlan[] = [];
  const warnings: PlanWarning[] = [];
  const errors: PlanError[] = [];

  // Import analysis warnings
  for (const w of analysis.warnings) {
    warnings.push({
      code: w.code,
      message: w.message,
      file: w.file,
      severity: w.severity,
    });
  }

  // Warn if no established access pattern detected
  if (analysis.accessPatterns.length === 0 && analysis.i18n.library === "none") {
    warnings.push({
      code: "NO_ESTABLISHED_ACCESS_PATTERN",
      message:
        "No established translation access pattern detected. Defaulting to react-i18next useTranslation hook.",
      severity: "warning",
    });
  }

  // Track planned keys per namespace to prevent duplicate creation entries
  const plannedTranslationsByKey = new Map<string, TranslationPlan>();

  // 8. Process each unique detected text group
  for (const [rawText, items] of groupedByText.entries()) {
    const primaryItem = items[0]!;

    // Check if all occurrences are explicitly rejected by candidateDecisions
    const allRejected = items.every((item) => {
      const candidateId = item.id || `${item.file}:${item.line}:${item.column}`;
      const decision =
        input?.candidateDecisions?.[candidateId] ??
        (item.id ? input?.candidateDecisions?.[item.id] : undefined) ??
        input?.candidateDecisions?.[item.text] ??
        input?.candidateDecisions?.[item.rawText];
      return decision === false;
    });

    if (allRejected) {
      for (const item of items) {
        const fileCtx =
          fileContexts.get(item.file) ||
          analyzeFileTranslationContext("", primaryAccessPattern);
        const sc = planSourceChange(item, "common", "SKIP", fileCtx, {
          confidenceThreshold,
          includeAmbiguous: input?.includeAmbiguous,
          candidateDecisions: input?.candidateDecisions,
        });
        sourceChanges.push(sc);
      }
      continue;
    }

    // Resolve namespace:
    // Priority: common candidate -> feature folder / mapping -> file bound ns -> fallback
    let preferredNs = primaryItem.suggestedNamespace || "common";

    // If file has a bound namespace (e.g. useTranslation("auth")), check if preferred
    const primaryFileCtx = fileContexts.get(primaryItem.file);
    if (
      primaryFileCtx?.boundNamespaces.length &&
      preferredNs !== "common"
    ) {
      preferredNs = primaryFileCtx.boundNamespaces[0]!;
    } else {
      preferredNs = resolveSuggestedNamespace(
        primaryItem.file,
        rawText,
        analysis.namespaces,
        null
      );
    }

    // Step A: Check Existing Translations
    const match = resolveExistingTranslation(
      rawText,
      preferredNs,
      existingSource,
      0.85
    );

    let finalNamespace: string;
    let finalKey: string;
    let finalAction = match.action;

    if (match.action === "REUSE" && match.namespace && match.key) {
      finalNamespace = match.namespace;
      finalKey = match.key;
    } else {
      // Step B: Generate new semantic key & resolve collision
      finalNamespace = preferredNs;
      const candidateKey = generateSemanticKey(rawText);

      const nsKeys = namespaceUsedKeys.get(finalNamespace) || new Set<string>();
      namespaceUsedKeys.set(finalNamespace, nsKeys);
      const nsKeyValues = namespaceKeyValues.get(finalNamespace) || new Map<string, string>();
      namespaceKeyValues.set(finalNamespace, nsKeyValues);

      const collision = resolveKeyCollision(
        candidateKey,
        rawText,
        finalNamespace,
        nsKeys,
        nsKeyValues
      );

      finalKey = collision.key;
      finalAction = collision.action;

      nsKeys.add(finalKey);
      nsKeyValues.set(finalKey, rawText);
    }

    // Translation entry identifier
    const translationId = `${finalNamespace}:${finalKey}`;
    let transPlan = plannedTranslationsByKey.get(translationId);

    if (!transPlan) {
      const targets = planTargetLocales(finalNamespace, finalKey, localeContext);
      const srcFilePath = getLocaleFilePath(
        localeContext.localeDirectory,
        sourceLocale,
        finalNamespace,
        isSubdirStructure
      );

      transPlan = {
        namespace: finalNamespace,
        key: finalKey,
        sourceText: rawText,
        action: finalAction,
        matchType: match.matchType,
        matchConfidence: match.confidence > 0 ? match.confidence : undefined,
        existingKey: match.key,
        existingNamespace: match.namespace,
        sourceLocale: {
          locale: sourceLocale,
          value: rawText,
          filePath: srcFilePath,
        },
        targets,
        variables: primaryItem.variables,
        occurrences: items.length,
        ...(primaryItem.isPlural
          ? {
              isPlural: true,
              pluralVariable: primaryItem.pluralVariable,
              pluralForm: primaryItem.pluralForm,
            }
          : {}),
        ...(primaryItem.isRichText
          ? {
              isRichText: true,
              richTextComponents: primaryItem.richTextComponents,
            }
          : {}),
      };

      plannedTranslationsByKey.set(translationId, transPlan);
      translations.push(transPlan);
    } else {
      transPlan.occurrences += items.length;
    }

    // Step C: Plan Source Changes for each occurrence
    for (const item of items) {
      const fileCtx =
        fileContexts.get(item.file) ||
        analyzeFileTranslationContext("", primaryAccessPattern);

      const sc = planSourceChange(item, finalNamespace, finalKey, fileCtx, {
        confidenceThreshold,
        includeAmbiguous: input?.includeAmbiguous,
        candidateDecisions: input?.candidateDecisions,
      });

      sourceChanges.push(sc);

      if (sc.status === "UNSUPPORTED") {
        warnings.push({
          code: "UNSUPPORTED_SOURCE_CONSTRUCT",
          message: `${sc.file}:${sc.location.line}: ${sc.reason}`,
          file: sc.file,
          severity: "warning",
        });
      }
    }
  }

  // 9. Coordinate multi-namespace file requirements, hook changes, and prefixing
  const itemsByLocation = new Map<string, DetectedString>();
  for (const it of scanResult.items) {
    itemsByLocation.set(`${it.file}:${it.line}:${it.column}`, it);
  }

  const fileCodeChangesMap = new Map<string, CodeChange[]>();

  for (const relFile of uniqueFiles) {
    const fileCtx = fileContexts.get(relFile);
    if (!fileCtx) continue;

    // Source changes belonging to this file that will be applied or reviewed
    const fileSCs = sourceChanges.filter(
      (sc) => sc.file === relFile && sc.action !== "SKIP"
    );
    if (fileSCs.length === 0) continue;

    // Collect all namespaces used across source changes in this file
    const fileNamespaces = new Set<string>();
    for (const sc of fileSCs) {
      fileNamespaces.add(sc.namespace);
    }

    const existingBound = [...fileCtx.boundNamespaces];
    let mergedNamespaces: string[];

    if (existingBound.length > 0) {
      // Existing hook: keep original bound namespaces in front, append newly referenced namespaces
      mergedNamespaces = [...existingBound];
      for (const ns of fileNamespaces) {
        if (!mergedNamespaces.includes(ns)) {
          mergedNamespaces.push(ns);
        }
      }
    } else {
      // Greenfield or un-migrated file:
      // Prioritize feature-specific namespace (non-"common") as primary if present
      const nonCommon = Array.from(fileNamespaces).filter((ns) => ns !== "common");
      const primaryNs =
        nonCommon.length > 0
          ? nonCommon[0]!
          : fileNamespaces.values().next().value || "common";
      mergedNamespaces = [
        primaryNs,
        ...Array.from(fileNamespaces).filter((ns) => ns !== primaryNs),
      ];
    }

    // Update file context bound namespaces to reflect multi-namespace setup
    fileCtx.boundNamespaces = mergedNamespaces;

    // Recompute replacement expressions with the established boundNamespaces
    for (const sc of fileSCs) {
      const locKey = `${sc.file}:${sc.location.line}:${sc.location.column}`;
      const matchingItem = itemsByLocation.get(locKey);
      if (matchingItem) {
        sc.replacement = buildReplacementExpression(
          matchingItem,
          sc.namespace,
          sc.key,
          fileCtx
        );
      }
    }

    // Determine unified code changes for this file (ADD_HOOK or UPDATE_HOOK, ADD_IMPORT)
    const hasRichText = fileSCs.some((sc) => sc.replacement.includes("<Trans"));
    const fileChanges = determineRequiredCodeChanges(
      {
        ...fileCtx,
        boundNamespaces: existingBound,
      },
      mergedNamespaces,
      hasRichText
    );

    fileCodeChangesMap.set(relFile, fileChanges);
  }

  // Attach deduplicated required code changes to each sourceChange
  for (const sc of sourceChanges) {
    if (fileCodeChangesMap.has(sc.file)) {
      sc.requiredCodeChanges = fileCodeChangesMap.get(sc.file);
    }
  }

  // 10. Sort outputs deterministically
  translations.sort((a, b) => {
    if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
    return a.key.localeCompare(b.key);
  });

  sourceChanges.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.location.line !== b.location.line) return a.location.line - b.location.line;
    return a.location.column - b.location.column;
  });

  warnings.sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return a.message.localeCompare(b.message);
  });

  // 11. Compute Summary Counts
  let reusedKeysCount = 0;
  let newKeysCount = 0;
  for (const t of translations) {
    if (t.action === "REUSE") {
      reusedKeysCount++;
    } else {
      newKeysCount++;
    }
  }

  let requiresReviewCount = 0;
  const affectedSourceFiles = new Set<string>();
  for (const sc of sourceChanges) {
    if (sc.action === "REVIEW") {
      requiresReviewCount++;
    } else if (sc.action === "REPLACE") {
      affectedSourceFiles.add(sc.file);
    }
  }

  const affectedLocaleFiles = new Set<string>();
  for (const t of translations) {
    if (t.action === "CREATE" && t.sourceLocale.filePath) {
      affectedLocaleFiles.add(t.sourceLocale.filePath);
    }
    for (const tgt of t.targets) {
      if (tgt.action === "CREATE_TRANSLATION" && tgt.filePath) {
        affectedLocaleFiles.add(tgt.filePath);
      }
    }
  }

  const summary: PlanSummary = {
    totalDetected: scanResult.total,
    userFacingCount: scanResult.userFacingCount,
    ignoredCount: scanResult.technicalCount,
    reusedKeysCount,
    newKeysCount,
    requiresReviewCount,
    sourceFilesAffected: affectedSourceFiles.size,
    localeFilesAffected: affectedLocaleFiles.size,
  };

  return {
    version: "1.0.0",
    project: {
      root: toPosixPath(projectRoot),
      framework: analysis.framework,
      library: setupPlan ? "react-i18next" : analysis.i18n.library,
    },
    scope: {
      include: input?.include || [],
      exclude: input?.exclude || [],
    },
    locales: {
      source: sourceLocale,
      targets: targetLocales,
    },
    summary,
    translations,
    sourceChanges,
    setup: setupPlan,
    warnings,
    errors,
  };
}
