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
        const nsMap = new Map<string, string>();
        for (const [k, v] of Object.entries(content)) {
          if (typeof v === "string") {
            nsMap.set(k, v);
          }
        }
        localeMap.set(ns, nsMap);
      }
    } else {
      isSubdirStructure = false;
      const singleFile = path.join(fullLocaleDir, `${locale}.json`);
      const content = await readJsonFile<Record<string, unknown>>(singleFile);
      if (content) {
        for (const [k, v] of Object.entries(content)) {
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            const nsMap = new Map<string, string>();
            for (const [subK, subV] of Object.entries(v as Record<string, unknown>)) {
              if (typeof subV === "string") {
                nsMap.set(subK, subV);
              }
            }
            localeMap.set(k, nsMap);
          }
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

  // 4. Load existing translations
  const existingSource = await loadExistingTranslations(
    projectRoot,
    analysis.i18n.localeDirectory,
    sourceLocale
  );

  const { translations: targetLocaleTranslations, isSubdirStructure } =
    await loadTargetLocaleTranslations(
      projectRoot,
      analysis.i18n.localeDirectory,
      targetLocales
    );

  const localeContext: LocalePlanningContext = {
    projectRoot,
    localeDirectory: analysis.i18n.localeDirectory,
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

  const primaryAccessPattern =
    analysis.accessPatterns.length > 0 ? analysis.accessPatterns[0] : "useTranslation";

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

  // 9. Aggregate file-level required code changes (imports and hooks)
  const fileCodeChangesMap = new Map<string, CodeChange[]>();
  for (const sc of sourceChanges) {
    if (sc.requiredCodeChanges && sc.requiredCodeChanges.length > 0) {
      const existing = fileCodeChangesMap.get(sc.file) || [];
      for (const change of sc.requiredCodeChanges) {
        if (!existing.some((e) => e.type === change.type && e.value === change.value)) {
          existing.push(change);
        }
      }
      fileCodeChangesMap.set(sc.file, existing);
    }
  }

  // Deduplicate required code changes on each sourceChange
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
      library: analysis.i18n.library,
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
    warnings,
    errors,
  };
}
