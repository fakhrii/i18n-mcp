import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  TranslateI18nInput,
  TranslationItemResult,
  TranslationItemStatus,
  TranslationServiceResult,
} from "../../models/translation.js";
import {
  DictionaryTranslationProvider,
  type ITranslationProvider,
} from "./translation-provider.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { loadProjectConfig } from "../../config/config-loader.js";
import { loadExistingTranslations } from "../planning/existing-key-resolver.js";
import {
  dirExists,
  fileExists,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import { getNestedValue, setNestedValue } from "../../utils/nested-json.js";
import { logger } from "../../utils/logger.js";

/**
 * Detects indentation style used in a JSON string.
 */
function detectIndentation(jsonString: string): string {
  const match = jsonString.match(/^[ \t]+(?=")/m);
  return match ? match[0] : "  ";
}

export interface TranslateI18nOptions {
  provider?: ITranslationProvider;
}

/**
 * Translates missing keys across target locales without overwriting existing translations.
 */
export async function translateI18n(
  input: TranslateI18nInput = {},
  options?: TranslateI18nOptions
): Promise<TranslationServiceResult> {
  const projectRoot = path.resolve(input.projectPath || process.cwd());
  const dryRun = input.dryRun ?? false;
  const warnings: string[] = [];
  const errors: string[] = [];
  const items: TranslationItemResult[] = [];
  const filesModifiedSet = new Set<string>();

  logger.info(`Running translation service for ${projectRoot} (dryRun=${dryRun})`);

  // 1. Analyze project to discover locale directory and configured locales
  let analysis;
  try {
    analysis = await analyzeProject(projectRoot);
  } catch (err: unknown) {
    return {
      translated: 0,
      unchanged: 0,
      pending: 0,
      review: 0,
      filesModified: [],
      items: [],
      errors: [`Failed to analyze project: ${String(err)}`],
      warnings: [],
    };
  }

  const localeDir = analysis.i18n.localeDirectory;
  if (!localeDir) {
    return {
      translated: 0,
      unchanged: 0,
      pending: 0,
      review: 0,
      filesModified: [],
      items: [],
      errors: ["No locale directory found in project."],
      warnings,
    };
  }

  const fullLocaleDir = path.join(projectRoot, localeDir);
  if (!(await dirExists(fullLocaleDir))) {
    return {
      translated: 0,
      unchanged: 0,
      pending: 0,
      review: 0,
      filesModified: [],
      items: [],
      errors: [`Locale directory does not exist: ${toPosixPath(localeDir)}`],
      warnings,
    };
  }

  // 2. Determine Locales
  const sourceLocale = input.sourceLocale || analysis.i18n.sourceLocale || "en";
  const targetLocales =
    input.targetLocales && input.targetLocales.length > 0
      ? input.targetLocales
      : analysis.i18n.targetLocales;

  if (!targetLocales || targetLocales.length === 0) {
    warnings.push("No target locales configured or detected for translation.");
    return {
      translated: 0,
      unchanged: 0,
      pending: 0,
      review: 0,
      filesModified: [],
      items: [],
      errors: [],
      warnings,
    };
  }

  // 3. Load Project Config & Glossary
  const config = await loadProjectConfig(projectRoot);
  const glossary = config?.glossary;

  // 4. Initialize Provider
  const provider = options?.provider || new DictionaryTranslationProvider();

  // 5. Check Directory Layout (subdirs vs single-file)
  const sourceSubdir = path.join(fullLocaleDir, sourceLocale);
  const isSubdirStructure = await dirExists(sourceSubdir);

  // 6. Load Source Locale Translations
  const existingSource = await loadExistingTranslations(
    projectRoot,
    localeDir,
    sourceLocale
  );

  const filterNamespaces =
    input.namespaces && input.namespaces.length > 0
      ? new Set(input.namespaces)
      : null;

  let translatedCount = 0;
  let unchangedCount = 0;
  let pendingCount = 0;
  let reviewCount = 0;

  // 7. Process each target locale
  for (const targetLocale of targetLocales) {
    // For single-file structure: locales/<targetLocale>.json
    if (!isSubdirStructure) {
      const relPath = toPosixPath(path.join(localeDir, `${targetLocale}.json`));
      const absPath = path.join(projectRoot, relPath);

      let currentContent = "{}";
      let indent = "  ";
      if (await fileExists(absPath)) {
        currentContent = (await readTextFile(absPath)) || "{}";
        indent = detectIndentation(currentContent);
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(currentContent);
      } catch (err: unknown) {
        errors.push(`Failed to parse JSON for ${relPath}: ${String(err)}`);
        continue;
      }

      let fileModified = false;

      for (const [namespace, keysMap] of existingSource.byNamespace.entries()) {
        if (filterNamespaces && !filterNamespaces.has(namespace)) continue;

        // In single-file with namespaces: parsed[namespace] is an object
        // If single namespace / flat: parsed itself is keysMap
        const isNamespaced =
          existingSource.byNamespace.size > 1 ||
          Object.keys(parsed).some(
            (k) => typeof parsed[k] === "object" && parsed[k] !== null
          ) ||
          Object.keys(parsed).some(
            (k) => k.toLowerCase() === namespace.toLowerCase()
          );

        let targetNamespaceObj: Record<string, unknown>;
        if (isNamespaced) {
          const matchedNsKey =
            Object.keys(parsed).find(
              (k) => k.toLowerCase() === namespace.toLowerCase()
            ) || namespace;

          if (
            typeof parsed[matchedNsKey] !== "object" ||
            parsed[matchedNsKey] === null ||
            Array.isArray(parsed[matchedNsKey])
          ) {
            parsed[matchedNsKey] = {};
          }
          targetNamespaceObj = parsed[matchedNsKey] as Record<string, unknown>;
        } else {
          targetNamespaceObj = parsed;
        }

        for (const [key, sourceText] of keysMap.entries()) {
          const existingVal = getNestedValue(targetNamespaceObj, key);
          if (typeof existingVal === "string" && existingVal.trim().length > 0) {
            unchangedCount++;
            items.push({
              namespace,
              key,
              sourceText,
              translatedText: existingVal,
              locale: targetLocale,
              status: "UNCHANGED",
            });
            continue;
          }

          // Translate missing key
          const transResp = await provider.translate({
            text: sourceText,
            sourceLocale,
            targetLocale,
            namespace,
            key,
            glossary,
          });

          let status: TranslationItemStatus = "TRANSLATED";
          if (!transResp.translated) {
            status = "PENDING";
            pendingCount++;
          } else if (transResp.confidence < 0.85) {
            status = "REVIEW";
            reviewCount++;
          } else {
            status = "TRANSLATED";
            translatedCount++;
          }

          items.push({
            namespace,
            key,
            sourceText,
            translatedText: transResp.translatedText,
            locale: targetLocale,
            status,
          });

          setNestedValue(targetNamespaceObj, key, transResp.translatedText);
          fileModified = true;
        }
      }

      if (fileModified) {
        filesModifiedSet.add(relPath);
        if (!dryRun) {
          try {
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            const serialized = JSON.stringify(parsed, null, indent) + "\n";
            await fs.writeFile(absPath, serialized, "utf8");
          } catch (err: unknown) {
            errors.push(`Failed to write locale file ${relPath}: ${String(err)}`);
          }
        }
      }

      continue;
    }

    // For subdir structure: locales/<targetLocale>/<namespace>.json
    for (const [namespace, keysMap] of existingSource.byNamespace.entries()) {
      if (filterNamespaces && !filterNamespaces.has(namespace)) continue;

      const relPath = toPosixPath(
        path.join(localeDir, targetLocale, `${namespace}.json`)
      );
      const absPath = path.join(projectRoot, relPath);

      let currentContent = "{}";
      let indent = "  ";
      if (await fileExists(absPath)) {
        currentContent = (await readTextFile(absPath)) || "{}";
        indent = detectIndentation(currentContent);
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(currentContent);
      } catch (err: unknown) {
        errors.push(`Failed to parse JSON for ${relPath}: ${String(err)}`);
        continue;
      }

      let fileModified = false;

      for (const [key, sourceText] of keysMap.entries()) {
        const existingVal = getNestedValue(parsed, key);
        if (typeof existingVal === "string" && existingVal.trim().length > 0) {
          unchangedCount++;
          items.push({
            namespace,
            key,
            sourceText,
            translatedText: existingVal,
            locale: targetLocale,
            status: "UNCHANGED",
          });
          continue;
        }

        // Translate missing key
        const transResp = await provider.translate({
          text: sourceText,
          sourceLocale,
          targetLocale,
          namespace,
          key,
          glossary,
        });

        let status: TranslationItemStatus = "TRANSLATED";
        if (!transResp.translated) {
          status = "PENDING";
          pendingCount++;
        } else if (transResp.confidence < 0.85) {
          status = "REVIEW";
          reviewCount++;
        } else {
          status = "TRANSLATED";
          translatedCount++;
        }

        items.push({
          namespace,
          key,
          sourceText,
          translatedText: transResp.translatedText,
          locale: targetLocale,
          status,
        });

        setNestedValue(parsed, key, transResp.translatedText);
        fileModified = true;
      }

      if (fileModified) {
        filesModifiedSet.add(relPath);
        if (!dryRun) {
          try {
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            const serialized = JSON.stringify(parsed, null, indent) + "\n";
            await fs.writeFile(absPath, serialized, "utf8");
          } catch (err: unknown) {
            errors.push(`Failed to write locale file ${relPath}: ${String(err)}`);
          }
        }
      }
    }
  }

  logger.info(
    `Translation complete: ${translatedCount} translated, ${unchangedCount} unchanged, ${pendingCount} pending, ${reviewCount} review`
  );

  return {
    translated: translatedCount,
    unchanged: unchangedCount,
    pending: pendingCount,
    review: reviewCount,
    filesModified: Array.from(filesModifiedSet).sort(),
    items,
    errors,
    warnings,
  };
}
