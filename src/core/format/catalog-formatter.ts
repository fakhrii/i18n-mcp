import * as path from "node:path";
import {
  fileExists,
  listFiles,
  readJsonFile,
  readTextFile,
  writeTextFile,
} from "../../utils/file-system.js";
import { isArbFile, parseArb, serializeArb, type ArbFile } from "../locale/arb-handler.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

export type KeySortOrder = "alphabetical" | "align-with-source";

export interface CatalogFormatOptions {
  projectPath?: string;
  locales?: string[];
  namespaces?: string[];
  sortOrder?: KeySortOrder;
  indent?: number;
  alignWithSource?: boolean;
  dryRun?: boolean;
}

export interface CatalogFormatResult {
  filesFormatted: string[];
  filesSkipped: string[];
  totalKeysSorted: number;
  dryRun: boolean;
  diff?: string;
}

/**
 * Natural alphabetical case-insensitive comparison.
 */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Recursively sorts an object's keys alphabetically.
 */
export function sortObjectKeysAlphabetical(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeysAlphabetical);
  }

  if (obj !== null && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort(naturalCompare);
    const result: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      result[key] = sortObjectKeysAlphabetical(record[key]);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively aligns an object's keys with the order of reference object keys.
 * Keys in `target` that exist in `source` are ordered first in source's order.
 * Extra keys in `target` not in `source` are sorted alphabetically at the end.
 */
export function alignObjectKeysWithSource(
  target: unknown,
  source: unknown
): unknown {
  if (
    target === null ||
    typeof target !== "object" ||
    Array.isArray(target) ||
    source === null ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return target;
  }

  const targetRec = target as Record<string, unknown>;
  const sourceRec = source as Record<string, unknown>;

  const sourceKeys = Object.keys(sourceRec);
  const targetKeys = new Set(Object.keys(targetRec));

  const orderedKeys: string[] = [];

  // 1. Add keys in source's order
  for (const sk of sourceKeys) {
    if (targetKeys.has(sk)) {
      orderedKeys.push(sk);
      targetKeys.delete(sk);
    }
  }

  // 2. Add extra keys in target sorted alphabetically
  const extraKeys = Array.from(targetKeys).sort(naturalCompare);
  orderedKeys.push(...extraKeys);

  const result: Record<string, unknown> = {};
  for (const k of orderedKeys) {
    result[k] = alignObjectKeysWithSource(targetRec[k], sourceRec[k]);
  }

  return result;
}

/**
 * Sorts an ARB catalog.
 * - Global @@ keys (e.g. @@locale) are kept at the top.
 * - Normal keys are sorted.
 * - Each @key metadata is positioned immediately after its corresponding key.
 */
export function sortArbCatalog(
  arb: ArbFile,
  referenceArb?: ArbFile
): ArbFile {
  const normalKeys = Array.from(arb.entries.keys());

  let sortedNormalKeys: string[];
  if (referenceArb) {
    const refNormalKeys = Array.from(referenceArb.entries.keys());
    const refKeySet = new Set(normalKeys);
    sortedNormalKeys = [];
    for (const rk of refNormalKeys) {
      if (refKeySet.has(rk)) {
        sortedNormalKeys.push(rk);
        refKeySet.delete(rk);
      }
    }
    const extra = Array.from(refKeySet).sort(naturalCompare);
    sortedNormalKeys.push(...extra);
  } else {
    sortedNormalKeys = normalKeys.sort(naturalCompare);
  }

  const newEntries = new Map<string, string>();
  for (const nk of sortedNormalKeys) {
    newEntries.set(nk, arb.entries.get(nk)!);
  }

  return {
    ...arb,
    entries: newEntries,
  };
}

/**
 * Formats, cleans, and sorts locale catalogs across a project.
 */
export async function formatCatalogs(
  options: CatalogFormatOptions = {}
): Promise<CatalogFormatResult> {
  const projectPath = options.projectPath || process.cwd();
  const analysis = await analyzeProject(projectPath);

  const sourceLocale = analysis.i18n.sourceLocale || "en";
  const indentSpaces = options.indent ?? 2;
  const dryRun = options.dryRun ?? false;
  const sortOrder = options.alignWithSource || options.sortOrder === "align-with-source"
    ? "align-with-source"
    : "alphabetical";

  const localeDir = analysis.i18n.localeDirectory
    ? path.resolve(projectPath, analysis.i18n.localeDirectory)
    : null;

  if (!localeDir || !(await fileExists(localeDir))) {
    throw new Error(`Locale directory not found in project: ${analysis.i18n.localeDirectory || "(none)"}`);
  }

  const filesFormatted: string[] = [];
  const filesSkipped: string[] = [];
  const diffs: string[] = [];
  let totalKeysSorted = 0;

  const isFlutter = analysis.framework === "flutter";

  if (isFlutter) {
    const allFiles = await listFiles(localeDir);
    const arbFiles = allFiles.filter((f) => isArbFile(f));

    // Load source ARB if alignWithSource
    let sourceArbObj: ArbFile | undefined;
    const sourceArbPath = arbFiles.find((f) => {
      const b = path.basename(f);
      return b === `app_${sourceLocale}.arb` || b === `${sourceLocale}.arb`;
    });

    if (sourceArbPath && (await fileExists(path.join(localeDir, sourceArbPath)))) {
      const raw = await readTextFile(path.join(localeDir, sourceArbPath));
      if (raw) sourceArbObj = parseArb(raw);
    }

    for (const arbFile of arbFiles) {
      const fullArbPath = path.join(localeDir, arbFile);
      const isSource = arbFile === sourceArbPath;

      const rawContent = (await readTextFile(fullArbPath)) || "";
      const parsed = parseArb(rawContent);

      const sorted = isSource || sortOrder === "alphabetical" || !sourceArbObj
        ? sortArbCatalog(parsed)
        : sortArbCatalog(parsed, sourceArbObj);

      totalKeysSorted += sorted.entries.size;

      const formatted = serializeArb(sorted);
      if (formatted !== rawContent) {
        const diff = generateUnifiedDiff(fullArbPath, rawContent, formatted);
        if (diff) diffs.push(diff);
        if (!dryRun) {
          await writeTextFile(fullArbPath, formatted);
        }
        filesFormatted.push(fullArbPath);
      } else {
        filesSkipped.push(fullArbPath);
      }
    }
  } else {
    // JSON files
    // 1. Direct files: locales/en.json, locales/fr.json
    const sourceJsonPath = path.join(localeDir, `${sourceLocale}.json`);
    let sourceJsonObj: unknown | undefined;

    if (await fileExists(sourceJsonPath)) {
      sourceJsonObj = await readJsonFile(sourceJsonPath);
    }

    const allFiles = await listFiles(localeDir);
    const jsonFiles = allFiles.filter((f) => f.endsWith(".json"));

    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(localeDir, jsonFile);
      const isSource = jsonPath === sourceJsonPath;

      // Filter by locales if requested
      if (options.locales && options.locales.length > 0) {
        const loc = path.basename(jsonFile, ".json");
        if (!options.locales.includes(loc)) {
          filesSkipped.push(jsonPath);
          continue;
        }
      }

      const rawContent = (await readTextFile(jsonPath)) || "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        filesSkipped.push(jsonPath);
        continue;
      }

      let sorted: unknown;
      if (sortOrder === "align-with-source" && !isSource && sourceJsonObj) {
        sorted = alignObjectKeysWithSource(parsed, sourceJsonObj);
      } else {
        sorted = sortObjectKeysAlphabetical(parsed);
      }

      const formatted = JSON.stringify(sorted, null, indentSpaces) + "\n";
      if (formatted !== rawContent) {
        const diff = generateUnifiedDiff(jsonPath, rawContent, formatted);
        if (diff) diffs.push(diff);
        if (!dryRun) {
          await writeTextFile(jsonPath, formatted);
        }
        filesFormatted.push(jsonPath);
      } else {
        filesSkipped.push(jsonPath);
      }
    }
  }

  logger.info(`Catalog formatting complete: ${filesFormatted.length} files formatted, ${filesSkipped.length} files up-to-date`);

  return {
    filesFormatted,
    filesSkipped,
    totalKeysSorted,
    dryRun,
    diff: diffs.join("\n"),
  };
}
