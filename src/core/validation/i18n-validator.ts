import * as path from "node:path";
import type {
  I18nValidationIssue,
  I18nValidationResult,
  ValidateI18nInput,
} from "../../models/validation.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { scanHardcodedTexts } from "../scanner/scanner.js";
import { resolveProjectFiles } from "../scope/scope-resolver.js";
import { detectDeadKeys, pruneUnusedKeys } from "./dead-key-detector.js";
import {
  dirExists,
  fileExists,
  listFiles,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import { logger } from "../../utils/logger.js";

/**
 * Extracts variable names from interpolation strings: {{var}}, {var}, ${var}.
 */
function extractInterpolationVariables(text: string): Set<string> {
  const vars = new Set<string>();
  const regex = /\{\{([^}]+)\}\}|\{([^}]+)\}|\$\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const varName = (match[1] || match[2] || match[3] || "").trim();
    if (varName) {
      vars.add(varName);
    }
  }
  return vars;
}

/**
 * Flattens nested translation object into dot-notation map: key -> string value.
 */
function flattenEntries(
  obj: Record<string, unknown>,
  prefix = ""
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      result.set(fullKey, v);
    } else if (typeof v === "number" || typeof v === "boolean") {
      result.set(fullKey, String(v));
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const sub = flattenEntries(v as Record<string, unknown>, fullKey);
      for (const [subK, subV] of sub.entries()) {
        result.set(subK, subV);
      }
    }
  }
  return result;
}

/**
 * Validates internationalization consistency across project locale files and source code.
 */
export async function validateI18n(
  input: ValidateI18nInput = {}
): Promise<I18nValidationResult> {
  const projectRoot = path.resolve(input.projectPath || process.cwd());
  const issues: I18nValidationIssue[] = [];

  logger.info(`Running i18n validator for project at ${projectRoot}`);

  // 1. Analyze project to detect configuration and locale files
  let analysis;
  try {
    analysis = await analyzeProject(projectRoot);
  } catch (err: unknown) {
    return {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      issues: [
        {
          type: "MALFORMED_JSON",
          severity: "error",
          namespace: "common",
          message: `Failed to analyze project: ${String(err)}`,
        },
      ],
      summary: {
        totalKeys: 0,
        localesChecked: [],
        namespacesChecked: [],
      },
    };
  }

  const localeDir = analysis.i18n.localeDirectory;
  if (!localeDir) {
    return {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      issues: [
        {
          type: "MISSING_TRANSLATION",
          severity: "error",
          namespace: "common",
          message: "No locale directory found in project.",
        },
      ],
      summary: {
        totalKeys: 0,
        localesChecked: [],
        namespacesChecked: [],
      },
    };
  }

  const fullLocaleDir = path.join(projectRoot, localeDir);
  const sourceLocale = analysis.i18n.sourceLocale || "en";

  // Locales to check
  const targetLocales =
    input.locales && input.locales.length > 0
      ? input.locales.filter((l) => l !== sourceLocale)
      : analysis.i18n.targetLocales;

  const allLocalesToCheck = [sourceLocale, ...targetLocales];
  const sourceSubdir = path.join(fullLocaleDir, sourceLocale);
  const isSubdirStructure = await dirExists(sourceSubdir);

  // Map: locale -> namespace -> key -> string value
  const translationsByLocale = new Map<
    string,
    Map<string, Map<string, string>>
  >();
  const namespacesCheckedSet = new Set<string>();

  const filterNamespaces =
    input.namespaces && input.namespaces.length > 0
      ? new Set(input.namespaces)
      : null;

  // 2. Load translations and check for MALFORMED_JSON
  for (const locale of allLocalesToCheck) {
    const localeMap = new Map<string, Map<string, string>>();
    translationsByLocale.set(locale, localeMap);

    if (isSubdirStructure) {
      const localePath = path.join(fullLocaleDir, locale);
      if (!(await dirExists(localePath))) {
        if (locale !== sourceLocale) {
          issues.push({
            type: "MISSING_TRANSLATION",
            severity: "error",
            namespace: "all",
            locale,
            message: `Locale folder '${locale}' does not exist in ${toPosixPath(localeDir)}.`,
          });
        }
        continue;
      }

      const files = await listFiles(localePath);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const ns = path.basename(f, ".json");
        if (filterNamespaces && !filterNamespaces.has(ns)) continue;
        namespacesCheckedSet.add(ns);

        const relFile = toPosixPath(path.join(localeDir, locale, f));
        const absFile = path.join(projectRoot, relFile);
        const rawContent = (await readTextFile(absFile)) || "";

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          issues.push({
            type: "MALFORMED_JSON",
            severity: "error",
            namespace: ns,
            locale,
            file: relFile,
            message: `Malformed JSON in locale file: ${relFile}`,
          });
          continue;
        }

        const flat = flattenEntries(parsed);
        localeMap.set(ns, flat);
      }
    } else {
      // Single file structure: locales/<locale>.json
      const relFile = toPosixPath(path.join(localeDir, `${locale}.json`));
      const absFile = path.join(projectRoot, relFile);

      if (!(await fileExists(absFile))) {
        if (locale !== sourceLocale) {
          issues.push({
            type: "MISSING_TRANSLATION",
            severity: "error",
            namespace: "all",
            locale,
            file: relFile,
            message: `Locale file '${relFile}' does not exist.`,
          });
        }
        continue;
      }

      const rawContent = (await readTextFile(absFile)) || "";
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        issues.push({
          type: "MALFORMED_JSON",
          severity: "error",
          namespace: "common",
          locale,
          file: relFile,
          message: `Malformed JSON in locale file: ${relFile}`,
        });
        continue;
      }

      // Check if top-level keys are namespaces
      let isNamespaced = false;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          isNamespaced = true;
          if (filterNamespaces && !filterNamespaces.has(k)) continue;
          namespacesCheckedSet.add(k);
          const flat = flattenEntries(v as Record<string, unknown>);
          localeMap.set(k, flat);
        }
      }

      if (!isNamespaced) {
        const ns = "common";
        if (!filterNamespaces || filterNamespaces.has(ns)) {
          namespacesCheckedSet.add(ns);
          localeMap.set(ns, flattenEntries(parsed));
        }
      }
    }
  }

  // 3. Compare Source Locale against Target Locales
  const sourceTranslations =
    translationsByLocale.get(sourceLocale) || new Map<string, Map<string, string>>();

  let totalKeys = 0;
  for (const [, keysMap] of sourceTranslations.entries()) {
    totalKeys += keysMap.size;
  }

  for (const targetLocale of targetLocales) {
    const targetTranslations =
      translationsByLocale.get(targetLocale) ||
      new Map<string, Map<string, string>>();

    // Check MISSING_TRANSLATION & MISSING_VARIABLE
    for (const [ns, sourceKeys] of sourceTranslations.entries()) {
      if (filterNamespaces && !filterNamespaces.has(ns)) continue;
      const targetKeys = targetTranslations.get(ns);
      const targetFile = isSubdirStructure
        ? toPosixPath(path.join(localeDir, targetLocale, `${ns}.json`))
        : toPosixPath(path.join(localeDir, `${targetLocale}.json`));

      for (const [key, sourceValue] of sourceKeys.entries()) {
        const targetValue = targetKeys?.get(key);

        if (targetValue === undefined || targetValue.trim().length === 0) {
          issues.push({
            type: "MISSING_TRANSLATION",
            severity: "error",
            namespace: ns,
            key,
            locale: targetLocale,
            file: targetFile,
            message: `Missing translation for '${ns}:${key}' in locale '${targetLocale}'.`,
          });
        } else {
          // Check variable consistency
          const srcVars = extractInterpolationVariables(sourceValue);
          const tgtVars = extractInterpolationVariables(targetValue);

          const missingInTarget: string[] = [];
          for (const v of srcVars) {
            if (!tgtVars.has(v)) {
              missingInTarget.push(v);
            }
          }

          const unexpectedInTarget: string[] = [];
          for (const v of tgtVars) {
            if (!srcVars.has(v)) {
              unexpectedInTarget.push(v);
            }
          }

          if (missingInTarget.length > 0 || unexpectedInTarget.length > 0) {
            issues.push({
              type: "MISSING_VARIABLE",
              severity: "error",
              namespace: ns,
              key,
              locale: targetLocale,
              file: targetFile,
              message: `Interpolation variable mismatch in '${ns}:${key}' for locale '${targetLocale}'. Expected: [${Array.from(
                srcVars
              ).join(", ")}], found: [${Array.from(tgtVars).join(", ")}]`,
            });
          }
        }
      }
    }

    // Check ORPHAN_KEY in target locale
    for (const [ns, targetKeys] of targetTranslations.entries()) {
      if (filterNamespaces && !filterNamespaces.has(ns)) continue;
      const sourceKeys = sourceTranslations.get(ns);
      const targetFile = isSubdirStructure
        ? toPosixPath(path.join(localeDir, targetLocale, `${ns}.json`))
        : toPosixPath(path.join(localeDir, `${targetLocale}.json`));

      for (const key of targetKeys.keys()) {
        if (!sourceKeys || !sourceKeys.has(key)) {
          issues.push({
            type: "ORPHAN_KEY",
            severity: "warning",
            namespace: ns,
            key,
            locale: targetLocale,
            file: targetFile,
            message: `Orphan key '${ns}:${key}' found in locale '${targetLocale}', but does not exist in source locale '${sourceLocale}'.`,
          });
        }
      }
    }
  }

  // 4. Optionally check source code for remaining unextracted strings
  if (input.checkSourceCode) {
    try {
      const scan = await scanHardcodedTexts(projectRoot, {
        scope: input.scope,
        onlyUserFacing: true,
        minConfidence: 0.7,
      });

      for (const item of scan.items) {
        issues.push({
          type: "HARDCODED_STRING",
          severity: "warning",
          namespace: item.suggestedNamespace || "common",
          key: item.suggestedKey,
          file: item.file,
          message: `Remaining user-facing hardcoded string: "${item.text}" at line ${item.line}`,
        });
      }
    } catch (err: unknown) {
      logger.warn(`Source code check during validation failed: ${String(err)}`);
    }
  }

  // 5. Optionally check or prune unused / dead keys
  let unusedKeysCount = 0;
  let prunedKeysCount = 0;

  if (input.checkUnusedKeys || input.pruneUnusedKeys) {
    try {
      const sourceFiles = await resolveProjectFiles(projectRoot, { scope: input.scope });
      const deadResult = await detectDeadKeys({
        projectRoot,
        sourceFiles,
        sourceTranslations,
      });

      unusedKeysCount = deadResult.unusedKeys.length;
      for (const u of deadResult.unusedKeys) {
        issues.push({
          type: "UNUSED_KEY",
          severity: "warning",
          namespace: u.namespace,
          key: u.key,
          message: `Translation key '${u.namespace}:${u.key}' is defined in locale catalog but not referenced in source code.`,
        });
      }

      if (input.pruneUnusedKeys && deadResult.unusedKeys.length > 0) {
        prunedKeysCount = await pruneUnusedKeys({
          projectRoot,
          localeDirectory: localeDir,
          unusedKeys: deadResult.unusedKeys,
        });
      }
    } catch (err: unknown) {
      logger.warn(`Unused key check failed: ${String(err)}`);
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    summary: {
      totalKeys,
      localesChecked: allLocalesToCheck,
      namespacesChecked: Array.from(namespacesCheckedSet).sort(),
      ...(input.checkUnusedKeys || input.pruneUnusedKeys
        ? { unusedKeysCount, prunedKeysCount }
        : {}),
    },
  };
}
