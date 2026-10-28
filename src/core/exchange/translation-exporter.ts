import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  ExportTranslationsOptions,
  ExportTranslationsResult,
  TranslationExchangeFormat,
  TranslationExchangeUnit,
} from "../../models/exchange.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { loadExistingTranslations } from "../planning/existing-key-resolver.js";
import { buildXliff12, buildXliff20 } from "./xliff-builder.js";
import { buildTmx14 } from "./tmx-builder.js";
import { dirExists, fileExists, listFiles, readTextFile, toPosixPath } from "../../utils/file-system.js";
import { isArbFile, parseArb, type ArbFile } from "../locale/arb-handler.js";
import { logger } from "../../utils/logger.js";

/**
 * Exports project locale catalogs (JSON or Flutter ARB) into XLIFF (1.2 / 2.0) or TMX 1.4 translation exchange files.
 */
export async function exportTranslations(
  options: ExportTranslationsOptions = {}
): Promise<ExportTranslationsResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const format: TranslationExchangeFormat = options.format || "xliff-1.2";
  const includeNotes = options.includeNotes ?? true;

  logger.info(`Exporting translations from ${projectRoot} using format ${format}`);

  const analysis = await analyzeProject(projectRoot);
  const localeDir = analysis.i18n.localeDirectory;

  if (!localeDir) {
    throw new Error("No locale directory found in project.");
  }

  const fullLocaleDir = path.join(projectRoot, localeDir);
  if (!(await dirExists(fullLocaleDir))) {
    throw new Error(`Locale directory does not exist: ${toPosixPath(localeDir)}`);
  }

  const sourceLocale = options.sourceLocale || analysis.i18n.sourceLocale || "en";
  let targetLocales = options.targetLocales && options.targetLocales.length > 0
    ? options.targetLocales
    : analysis.i18n.targetLocales;

  if (!targetLocales || targetLocales.length === 0) {
    targetLocales = ["fr"]; // fallback default target if project has only source locale
  }

  // Load source translations
  const sourceExisting = await loadExistingTranslations(projectRoot, localeDir, sourceLocale);

  // Check if Flutter ARB
  const dirFiles = await listFiles(fullLocaleDir);
  const isFlutter = analysis.framework === "flutter" || dirFiles.some((f) => isArbFile(f));
  let sourceArb: ArbFile | null = null;

  if (isFlutter) {
    const sourceArbPath = path.join(fullLocaleDir, `app_${sourceLocale}.arb`);
    if (await fileExists(sourceArbPath)) {
      const arbContent = await readTextFile(sourceArbPath);
      if (arbContent) {
        sourceArb = parseArb(arbContent);
      }
    }
  }

  const nsFilter = options.namespaces && options.namespaces.length > 0
    ? new Set(options.namespaces)
    : null;

  const filesExported: string[] = [];
  let totalUnitsExported = 0;
  let lastXmlContent = "";

  for (const targetLocale of targetLocales) {
    if (targetLocale.toLowerCase() === sourceLocale.toLowerCase()) continue;

    // Load existing target translations (if any)
    const targetExisting = await loadExistingTranslations(projectRoot, localeDir, targetLocale);

    const units: TranslationExchangeUnit[] = [];

    for (const item of sourceExisting.items) {
      if (nsFilter && !nsFilter.has(item.namespace)) continue;

      // Extract ARB description if available
      let note: string | undefined;
      if (sourceArb) {
        const meta = sourceArb.keyMetadata.get(item.key);
        if (meta?.description) {
          note = meta.description;
        }
      }

      // Check for target translation
      const targetVal = targetExisting.byNamespace.get(item.namespace)?.get(item.key);
      const isTranslated = typeof targetVal === "string" && targetVal.trim().length > 0;

      // Compose full key ID
      const unitId =
        item.namespace && item.namespace !== "common" && item.namespace !== "app"
          ? `${item.namespace}.${item.key}`
          : item.key;

      units.push({
        id: unitId,
        source: item.value,
        target: isTranslated ? targetVal : undefined,
        namespace: item.namespace,
        note,
        state: isTranslated ? "translated" : "needs-translation",
      });
    }

    totalUnitsExported += units.length;

    let xmlOutput = "";
    if (format === "xliff-1.2") {
      xmlOutput = buildXliff12({
        sourceLocale,
        targetLocale,
        original: `${localeDir}/${sourceLocale}`,
        units,
        includeNotes,
      });
    } else if (format === "xliff-2.0") {
      xmlOutput = buildXliff20({
        sourceLocale,
        targetLocale,
        original: `${localeDir}/${sourceLocale}`,
        units,
        includeNotes,
      });
    } else if (format === "tmx-1.4") {
      xmlOutput = buildTmx14({
        sourceLocale,
        targetLocale,
        units,
        includeNotes,
      });
    }

    lastXmlContent = xmlOutput;

    // Save to disk if outputPath provided
    if (options.outputPath) {
      const ext = format === "tmx-1.4" ? "tmx" : "xlf";
      let destFile: string;

      if (options.outputPath.endsWith(".xlf") || options.outputPath.endsWith(".xliff") || options.outputPath.endsWith(".tmx")) {
        destFile = path.isAbsolute(options.outputPath)
          ? options.outputPath
          : path.join(projectRoot, options.outputPath);
      } else {
        const destDir = path.isAbsolute(options.outputPath)
          ? options.outputPath
          : path.join(projectRoot, options.outputPath);
        await fs.mkdir(destDir, { recursive: true });
        destFile = path.join(destDir, `${sourceLocale}_${targetLocale}.${ext}`);
      }

      await fs.writeFile(destFile, xmlOutput, "utf8");
      filesExported.push(toPosixPath(path.relative(projectRoot, destFile)));
    }
  }

  return {
    projectRoot,
    format,
    sourceLocale,
    targetLocales,
    filesExported,
    totalUnitsExported,
    content: filesExported.length === 0 || filesExported.length === 1 ? lastXmlContent : undefined,
  };
}
