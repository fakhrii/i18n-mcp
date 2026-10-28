import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  ImportTranslationsOptions,
  ImportTranslationsResult,
  TranslationExchangeFormat,
} from "../../models/exchange.js";
import { parseXliff } from "./xliff-parser.js";
import { parseTmx } from "./tmx-parser.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import {
  dirExists,
  fileExists,
  listFiles,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import {
  isArbFile,
  parseArb,
  serializeArb,
  setArbEntry,
} from "../locale/arb-handler.js";
import { getNestedValue, setNestedValue } from "../../utils/nested-json.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

/**
 * Detects indentation style used in a JSON string.
 */
function detectIndentation(jsonString: string): string {
  const match = jsonString.match(/^[ \t]+(?=")/m);
  return match ? match[0] : "  ";
}

/**
 * Imports XLIFF (1.2 / 2.0) or TMX 1.4 translations into project catalogs (JSON or Flutter ARB).
 */
export async function importTranslations(
  options: ImportTranslationsOptions = {}
): Promise<ImportTranslationsResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const overwrite = options.overwrite ?? true;
  const dryRun = options.dryRun ?? false;

  logger.info(`Importing translations into ${projectRoot} (dryRun=${dryRun}, overwrite=${overwrite})`);

  let xmlContent = options.content;
  if (!xmlContent && options.filePath) {
    const absFilePath = path.isAbsolute(options.filePath)
      ? options.filePath
      : path.join(projectRoot, options.filePath);
    xmlContent = (await readTextFile(absFilePath)) || undefined;
  }

  if (!xmlContent || !xmlContent.trim()) {
    throw new Error("No translation exchange content or valid filePath provided for import.");
  }

  // Detect exchange format
  let format: TranslationExchangeFormat = options.format || "xliff-1.2";
  if (!options.format) {
    if (/<tmx/i.test(xmlContent)) {
      format = "tmx-1.4";
    } else if (/<xliff[^>]+version=["']2\./i.test(xmlContent)) {
      format = "xliff-2.0";
    } else {
      format = "xliff-1.2";
    }
  }

  // Parse translation units
  let sourceLocale: string | undefined;
  let targetLocale: string | undefined;
  let parsedUnits: Array<{
    id: string;
    source: string;
    target?: string;
    note?: string;
  }> = [];

  if (format === "tmx-1.4") {
    const tmxData = parseTmx(xmlContent, options.targetLocales?.[0]);
    sourceLocale = tmxData.sourceLocale;
    targetLocale = options.targetLocales?.[0] || tmxData.targetLocales[0] || "fr";
    parsedUnits = tmxData.units;
  } else {
    const xliffData = parseXliff(xmlContent);
    sourceLocale = xliffData.sourceLocale;
    targetLocale = options.targetLocales?.[0] || xliffData.targetLocale || "fr";
    parsedUnits = xliffData.units;
  }

  const analysis = await analyzeProject(projectRoot);
  const localeDir = analysis.i18n.localeDirectory;
  if (!localeDir) {
    throw new Error("No locale directory found in project.");
  }

  const fullLocaleDir = path.join(projectRoot, localeDir);
  if (!(await dirExists(fullLocaleDir))) {
    throw new Error(`Locale directory does not exist: ${toPosixPath(localeDir)}`);
  }

  const dirFiles = await listFiles(fullLocaleDir);
  const isFlutter = analysis.framework === "flutter" || dirFiles.some((f) => isArbFile(f));
  const isSubdirStructure = await dirExists(path.join(fullLocaleDir, targetLocale));

  let unitsProcessed = 0;
  let unitsImported = 0;
  let unitsSkipped = 0;
  const filesModified: string[] = [];
  const diffParts: string[] = [];

  if (isFlutter) {
    // Flutter ARB Import
    const targetArbRel = toPosixPath(path.join(localeDir, `app_${targetLocale}.arb`));
    const targetArbAbs = path.join(projectRoot, targetArbRel);

    let arbContent = "{\n  \"@@locale\": \"" + targetLocale + "\"\n}\n";
    if (await fileExists(targetArbAbs)) {
      arbContent = (await readTextFile(targetArbAbs)) || arbContent;
    }

    const arb = parseArb(arbContent);
    let modified = false;

    for (const unit of parsedUnits) {
      unitsProcessed++;
      if (unit.target === undefined || unit.target.trim().length === 0) {
        unitsSkipped++;
        continue;
      }

      const existingVal = arb.entries.get(unit.id);
      if (existingVal !== undefined && !overwrite) {
        unitsSkipped++;
        continue;
      }

      setArbEntry(arb, unit.id, unit.target, unit.note ? { description: unit.note } : undefined);
      unitsImported++;
      modified = true;
    }

    if (modified) {
      const updatedArbContent = serializeArb(arb);
      const diff = generateUnifiedDiff(targetArbRel, arbContent, updatedArbContent);
      if (diff) diffParts.push(diff);
      filesModified.push(targetArbRel);

      if (!dryRun) {
        await fs.writeFile(targetArbAbs, updatedArbContent, "utf8");
      }
    }
  } else if (isSubdirStructure) {
    // Subdirectory JSON structure: locales/{targetLocale}/{namespace}.json
    const targetDirAbs = path.join(fullLocaleDir, targetLocale);
    await fs.mkdir(targetDirAbs, { recursive: true });

    // Group units by namespace
    const unitsByNamespace = new Map<string, typeof parsedUnits>();
    for (const unit of parsedUnits) {
      let ns = "common";
      let key = unit.id;

      if (unit.id.includes(".")) {
        const parts = unit.id.split(".");
        ns = parts[0]!;
        key = parts.slice(1).join(".");
      }

      if (!unitsByNamespace.has(ns)) {
        unitsByNamespace.set(ns, []);
      }
      unitsByNamespace.get(ns)!.push({ ...unit, id: key });
    }

    for (const [namespace, nsUnits] of unitsByNamespace.entries()) {
      const targetRel = toPosixPath(path.join(localeDir, targetLocale, `${namespace}.json`));
      const targetAbs = path.join(projectRoot, targetRel);

      let currentContent = "{}";
      let indent = "  ";
      if (await fileExists(targetAbs)) {
        currentContent = (await readTextFile(targetAbs)) || "{}";
        indent = detectIndentation(currentContent);
      }

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(currentContent);
      } catch {
        parsed = {};
      }

      let fileModified = false;

      for (const unit of nsUnits) {
        unitsProcessed++;
        if (unit.target === undefined || unit.target.trim().length === 0) {
          unitsSkipped++;
          continue;
        }

        const existingVal = getNestedValue(parsed, unit.id);
        if (existingVal !== undefined && !overwrite) {
          unitsSkipped++;
          continue;
        }

        setNestedValue(parsed, unit.id, unit.target);
        unitsImported++;
        fileModified = true;
      }

      if (fileModified) {
        const updatedContent = JSON.stringify(parsed, null, indent) + "\n";
        const diff = generateUnifiedDiff(targetRel, currentContent, updatedContent);
        if (diff) diffParts.push(diff);
        filesModified.push(targetRel);

        if (!dryRun) {
          await fs.writeFile(targetAbs, updatedContent, "utf8");
        }
      }
    }
  } else {
    // Single-file JSON: locales/{targetLocale}.json
    const targetRel = toPosixPath(path.join(localeDir, `${targetLocale}.json`));
    const targetAbs = path.join(projectRoot, targetRel);

    let currentContent = "{}";
    let indent = "  ";
    if (await fileExists(targetAbs)) {
      currentContent = (await readTextFile(targetAbs)) || "{}";
      indent = detectIndentation(currentContent);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(currentContent);
    } catch {
      parsed = {};
    }

    let fileModified = false;

    for (const unit of parsedUnits) {
      unitsProcessed++;
      if (unit.target === undefined || unit.target.trim().length === 0) {
        unitsSkipped++;
        continue;
      }

      const existingVal = getNestedValue(parsed, unit.id);
      if (existingVal !== undefined && !overwrite) {
        unitsSkipped++;
        continue;
      }

      setNestedValue(parsed, unit.id, unit.target);
      unitsImported++;
      fileModified = true;
    }

    if (fileModified) {
      const updatedContent = JSON.stringify(parsed, null, indent) + "\n";
      const diff = generateUnifiedDiff(targetRel, currentContent, updatedContent);
      if (diff) diffParts.push(diff);
      filesModified.push(targetRel);

      if (!dryRun) {
        await fs.writeFile(targetAbs, updatedContent, "utf8");
      }
    }
  }

  return {
    projectRoot,
    format,
    sourceLocale,
    targetLocale,
    unitsProcessed,
    unitsImported,
    unitsSkipped,
    filesModified,
    dryRun,
    diff: diffParts.length > 0 ? diffParts.join("\n\n") : undefined,
  };
}
