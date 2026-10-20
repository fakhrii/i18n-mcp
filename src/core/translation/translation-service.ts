import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  TranslateI18nInput,
  TranslationItemResult,
  TranslationItemStatus,
  TranslationServiceResult,
} from "../../models/translation.js";
import type { ITranslationProvider } from "./translation-provider.js";
import { createTranslationProvider } from "./cloud-providers.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { loadProjectConfig } from "../../config/config-loader.js";
import { loadExistingTranslations } from "../planning/existing-key-resolver.js";
import type { I18nStructureType } from "../../models/project.js";
import {
  dirExists,
  fileExists,
  listFiles,
  readJsonFile,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import {
  isArbFile,
  parseArb,
  serializeArb,
  setArbEntry,
  type ArbFile,
} from "../locale/arb-handler.js";
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
 * Looks up an agent- or caller-provided translation across supported key structures:
 * 1. Nested namespace: provided[locale][namespace][key]
 * 2. Colon-prefixed compound key: provided[locale]['namespace:key']
 * 3. Dot-prefixed compound key: provided[locale]['namespace.key']
 * 4. Flat key: provided[locale][key]
 */
export function lookupProvidedTranslation(
  provided: Record<string, any> | undefined,
  locale: string,
  namespace: string,
  key: string
): string | undefined {
  if (!provided || typeof provided !== "object") return undefined;

  const localeData =
    provided[locale] ||
    provided[locale.toLowerCase()] ||
    provided[locale.slice(0, 2).toLowerCase()];

  if (!localeData || typeof localeData !== "object") return undefined;

  // 1. Nested namespace: provided[locale][namespace][key] (shallow or nested path)
  if (
    typeof localeData[namespace] === "object" &&
    localeData[namespace] !== null
  ) {
    if (typeof localeData[namespace][key] === "string") {
      return localeData[namespace][key];
    }
    const nestedInNs = getNestedValue(localeData[namespace], key);
    if (typeof nestedInNs === "string") {
      return nestedInNs;
    }
  }

  // 2. Colon-prefixed compound key: provided[locale]['namespace:key']
  const colonKey = `${namespace}:${key}`;
  if (typeof localeData[colonKey] === "string") {
    return localeData[colonKey];
  }

  // 3. Dot-prefixed compound key: provided[locale]['namespace.key'] (shallow or nested path)
  const dotKey = `${namespace}.${key}`;
  if (typeof localeData[dotKey] === "string") {
    return localeData[dotKey];
  }
  const nestedDot = getNestedValue(localeData, dotKey);
  if (typeof nestedDot === "string") {
    return nestedDot;
  }

  // 4. Flat or nested key directly under localeData
  if (typeof localeData[key] === "string") {
    return localeData[key];
  }
  const nestedKey = getNestedValue(localeData, key);
  if (typeof nestedKey === "string") {
    return nestedKey;
  }

  return undefined;
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
  const pendingItems: Array<{
    key: string;
    sourceText: string;
    locale: string;
    namespace?: string;
  }> = [];
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

  // 4. Initialize Provider (SmartTranslationProvider with optional cloud & non-blocking fallback)
  const provider =
    options?.provider ||
    createTranslationProvider({
      provider: input.provider || config?.translation?.provider,
      apiKey: input.apiKey || config?.translation?.apiKey,
      model: config?.translation?.model,
    });

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

  const dirFiles = await listFiles(fullLocaleDir);
  const isArb = dirFiles.some((f) => isArbFile(f)) || analysis.framework === "flutter";

  // Load source single-file JSON if applicable to inspect source schema (namespaces vs nested sections)
  let sourceSingleFileJson: Record<string, unknown> | null = null;
  if (!isSubdirStructure && !isArb) {
    const sourceSinglePath = path.join(fullLocaleDir, `${sourceLocale}.json`);
    if (await fileExists(sourceSinglePath)) {
      try {
        sourceSingleFileJson = await readJsonFile<Record<string, unknown>>(sourceSinglePath);
      } catch {
        sourceSingleFileJson = null;
      }
    }
  }

  const structureType: I18nStructureType =
    input.structure ||
    config?.structure ||
    analysis.i18n.structureType ||
    (isSubdirStructure ? "namespaces" : "nested");

  // 7. Process each target locale
  for (const targetLocale of targetLocales) {
    if (isArb) {
      let targetArbName = `app_${targetLocale}.arb`;
      const cand = dirFiles.find(
        (f) =>
          isArbFile(f) &&
          (f.includes(`_${targetLocale}.arb`) || f === `${targetLocale}.arb`)
      );
      if (cand) {
        targetArbName = cand;
      } else {
        const sourceArb = dirFiles.find(
          (f) =>
            isArbFile(f) &&
            (f.includes(`_${sourceLocale}.arb`) || f === `${sourceLocale}.arb`)
        );
        if (sourceArb) {
          if (sourceArb.startsWith("intl_")) {
            targetArbName = `intl_${targetLocale}.arb`;
          } else if (!sourceArb.includes("_")) {
            targetArbName = `${targetLocale}.arb`;
          }
        }
      }

      const relPath = toPosixPath(path.join(localeDir, targetArbName));
      const absPath = path.join(projectRoot, relPath);

      let currentContent = JSON.stringify({ "@@locale": targetLocale }, null, 2);
      let indent = "  ";
      if (await fileExists(absPath)) {
        currentContent = (await readTextFile(absPath)) || currentContent;
        indent = detectIndentation(currentContent);
      }

      let arb: ArbFile;
      try {
        arb = parseArb(currentContent);
        if (!arb.locale) arb.locale = targetLocale;
      } catch (err: unknown) {
        errors.push(`Failed to parse ARB for ${relPath}: ${String(err)}`);
        continue;
      }

      let fileModified = false;

      for (const [namespace, keysMap] of existingSource.byNamespace.entries()) {
        if (filterNamespaces && !filterNamespaces.has(namespace)) continue;

        for (const [key, sourceText] of keysMap.entries()) {
          const existingVal = arb.entries.get(key);
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

          // Check providedTranslations first
          const providedText = lookupProvidedTranslation(
            input.providedTranslations,
            targetLocale,
            namespace,
            key
          );

          if (providedText !== undefined) {
            translatedCount++;
            items.push({
              namespace,
              key,
              sourceText,
              translatedText: providedText,
              locale: targetLocale,
              status: "TRANSLATED",
            });
            setArbEntry(arb, key, providedText);
            fileModified = true;
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
            pendingItems.push({
              key,
              sourceText,
              locale: targetLocale,
              namespace,
            });
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

          setArbEntry(arb, key, transResp.translatedText);
          fileModified = true;
        }
      }

      if (fileModified) {
        filesModifiedSet.add(relPath);
        if (!dryRun) {
          try {
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            const serialized = serializeArb(arb, indent);
            await fs.writeFile(absPath, serialized, "utf8");
          } catch (err: unknown) {
            errors.push(`Failed to write ARB file ${relPath}: ${String(err)}`);
          }
        }
      }

      continue;
    }

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

        // In single-file with namespaces or nested objects: parsed[namespace] is an object
        // If single namespace / flat: parsed itself is keysMap
        const sourceHasNsObject =
          sourceSingleFileJson !== null &&
          typeof sourceSingleFileJson[namespace] === "object" &&
          sourceSingleFileJson[namespace] !== null &&
          !Array.isArray(sourceSingleFileJson[namespace]);

        const isNamespaced =
          sourceHasNsObject ||
          structureType === "namespaces" ||
          existingSource.byNamespace.size > 1 ||
          namespace !== "common" ||
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

          // Check providedTranslations first
          const providedText = lookupProvidedTranslation(
            input.providedTranslations,
            targetLocale,
            namespace,
            key
          );

          if (providedText !== undefined) {
            translatedCount++;
            items.push({
              namespace,
              key,
              sourceText,
              translatedText: providedText,
              locale: targetLocale,
              status: "TRANSLATED",
            });
            setNestedValue(targetNamespaceObj, key, providedText);
            fileModified = true;
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
            pendingItems.push({
              key,
              sourceText,
              locale: targetLocale,
              namespace,
            });
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

        // Check providedTranslations first
        const providedText = lookupProvidedTranslation(
          input.providedTranslations,
          targetLocale,
          namespace,
          key
        );

        if (providedText !== undefined) {
          translatedCount++;
          items.push({
            namespace,
            key,
            sourceText,
            translatedText: providedText,
            locale: targetLocale,
            status: "TRANSLATED",
          });
          setNestedValue(parsed, key, providedText);
          fileModified = true;
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
          pendingItems.push({
            key,
            sourceText,
            locale: targetLocale,
            namespace,
          });
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
    pendingItems: pendingItems.length > 0 ? pendingItems : undefined,
    errors,
    warnings,
  };
}
