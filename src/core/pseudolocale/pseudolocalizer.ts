import * as path from "node:path";
import {
  fileExists,
  listFiles,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile,
} from "../../utils/file-system.js";
import { parseArb, serializeArb, type ArbFile } from "../locale/arb-handler.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

export type PseudolocaleStrategy = "accented" | "bidi" | "expansion" | "all";
export type PseudolocaleDelimiter = "brackets" | "exclamation" | "none";

export interface PseudolocaleOptions {
  projectPath?: string;
  sourceLocale?: string;
  targetLocale?: string;
  strategy?: PseudolocaleStrategy;
  expansionRatio?: number;
  delimiter?: PseudolocaleDelimiter;
  namespaces?: string[];
  dryRun?: boolean;
}

export interface PseudolocaleResult {
  sourceLocale: string;
  targetLocale: string;
  filesModified: string[];
  keysTransformed: number;
  dryRun: boolean;
  diff?: string;
}

/**
 * Standard ASCII to accented diacritic mapping for pseudo-localization.
 */
const ACCENT_MAP: Record<string, string> = {
  a: "å", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î",
  j: "ĵ", k: "ķ", l: "ļ", m: "ɱ", n: "ñ", o: "ø", p: "þ", q: "q", r: "ř",
  s: "š", t: "ţ", u: "ü", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î",
  J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ", N: "Ñ", O: "Ø", P: "Þ", Q: "Q", R: "Ř",
  S: "Š", T: "Ţ", U: "Ü", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

/**
 * Regex for identifying tokens that should NEVER be pseudolocalized:
 * - HTML / XML tags: <tag>, </tag>, <tag attr="val" />
 * - Interpolations: {{variable}}, {variable}, {count, plural, ...}
 * - Printf specifiers: %s, %d, %1$s, %02d
 * - URLs: https://..., http://...
 * - Escape sequences: \n, \t, \r
 */
const PROTECTED_TOKEN_REGEX =
  /(?:<[^>]+>|\{\{[^}]+\}\}|\{[a-zA-Z0-9_]+\}|%[0-9$]*[a-zA-Z]|https?:\/\/[^\s"'<>]+|\\[ntr])/g;

/**
 * Transforms a single text string into pseudo-localized text while safely preserving tokens.
 */
export function pseudolocalizeString(
  text: string,
  options: {
    strategy?: PseudolocaleStrategy;
    expansionRatio?: number;
    delimiter?: PseudolocaleDelimiter;
  } = {}
): string {
  if (!text || text.trim().length === 0) {
    return text;
  }

  const strategy = options.strategy ?? "all";
  const expansionRatio = options.expansionRatio ?? 0.35;
  const delimiter = options.delimiter ?? "exclamation";

  // 1. Extract protected tokens into placeholders
  const tokens: string[] = [];
  const tokenizedText = text.replace(PROTECTED_TOKEN_REGEX, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `\uE000${idx}\uE001`;
  });

  // 2. Process non-token characters
  let processed = tokenizedText;

  // Accented transformation
  if (strategy === "accented" || strategy === "all") {
    processed = processed.replace(/[a-zA-Z]/g, (char) => ACCENT_MAP[char] || char);
  }

  // Expansion transformation
  if (strategy === "expansion" || strategy === "all") {
    const rawLen = text.length;
    const expandChars = Math.ceil(rawLen * expansionRatio);
    if (expandChars > 0) {
      // Create padding characters (~!~!...)
      let padding = "";
      const padChars = "~!@#$%^&*";
      for (let i = 0; i < expandChars; i++) {
        padding += padChars[i % padChars.length];
      }
      processed = `${processed} ${padding}`;
    }
  }

  // Bi-directional / RTL transformation (qps-plocm)
  if (strategy === "bidi") {
    // Wrap with Right-to-Left Embedding (RLE \u202B) and Pop Directional Formatting (PDF \u202C)
    // and reverse words between tokens
    const reversed = processed.split(" ").reverse().join(" ");
    processed = `\u202B${reversed}\u202C`;
  }

  // 3. Apply Delimiters
  let result = processed;
  if (delimiter === "exclamation") {
    result = `[!! ${processed} !!]`;
  } else if (delimiter === "brackets") {
    result = `[${processed}]`;
  }

  // 4. Restore protected tokens
  result = result.replace(/\uE000(\d+)\uE001/g, (_, idxStr) => {
    const idx = parseInt(idxStr, 10);
    return tokens[idx] ?? "";
  });

  return result;
}

/**
 * Recursively pseudolocalizes values in a JSON-serializable object.
 */
export function pseudolocalizeObject(
  obj: unknown,
  options: {
    strategy?: PseudolocaleStrategy;
    expansionRatio?: number;
    delimiter?: PseudolocaleDelimiter;
  } = {}
): unknown {
  if (typeof obj === "string") {
    return pseudolocalizeString(obj, options);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => pseudolocalizeObject(item, options));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = pseudolocalizeObject(value, options);
    }
    return result;
  }

  return obj;
}

/**
 * Pseudolocalizes an ARB object, preserving metadata keys and locale.
 */
export function pseudolocalizeArb(
  arb: ArbFile,
  options: {
    strategy?: PseudolocaleStrategy;
    expansionRatio?: number;
    delimiter?: PseudolocaleDelimiter;
  } = {}
): ArbFile {
  const newEntries = new Map<string, string>();

  for (const [key, value] of arb.entries.entries()) {
    newEntries.set(key, pseudolocalizeString(value, options));
  }

  return {
    ...arb,
    entries: newEntries,
  };
}

/**
 * Generates pseudolocale catalogs for a project based on the source locale files.
 */
export async function generatePseudolocale(
  options: PseudolocaleOptions = {}
): Promise<PseudolocaleResult> {
  const projectPath = options.projectPath || process.cwd();
  const analysis = await analyzeProject(projectPath);

  const sourceLocale = options.sourceLocale || analysis.i18n.sourceLocale || "en";
  const targetLocale = options.targetLocale || (options.strategy === "bidi" ? "qps-plocm" : "qps-ploc");
  const dryRun = options.dryRun ?? false;
  const localeDir = analysis.i18n.localeDirectory
    ? path.resolve(projectPath, analysis.i18n.localeDirectory)
    : null;

  if (!localeDir || !(await fileExists(localeDir))) {
    throw new Error(`Locale directory not found in project: ${analysis.i18n.localeDirectory || "(none)"}`);
  }

  const filesModified: string[] = [];
  let totalKeysTransformed = 0;
  const diffs: string[] = [];

  const pseudoOpts = {
    strategy: options.strategy ?? (targetLocale.includes("plocm") ? "bidi" : "all"),
    expansionRatio: options.expansionRatio ?? 0.35,
    delimiter: options.delimiter ?? "exclamation",
  };

  // Check if ARB structure (Flutter)
  const isFlutter = analysis.framework === "flutter";

  if (isFlutter) {
    const allFiles = await listFiles(localeDir);
    const sourceArbName = `app_${sourceLocale}.arb`;
    const targetArbName = `app_${targetLocale}.arb`;

    const sourceFile = allFiles.find((f) => path.basename(f) === sourceArbName || path.basename(f) === `${sourceLocale}.arb`);
    if (sourceFile) {
      const targetFilePath = path.join(localeDir, targetArbName);
      const rawSource = await readTextFile(path.join(localeDir, sourceFile));
      if (rawSource) {
        const arbObj = parseArb(rawSource);
        const pseudoArb = pseudolocalizeArb(arbObj, pseudoOpts);
        pseudoArb.locale = targetLocale;
        totalKeysTransformed += pseudoArb.entries.size;

        const newContent = serializeArb(pseudoArb);
        const oldContent = (await fileExists(targetFilePath)) ? (await readTextFile(targetFilePath)) || "" : "";

        if (newContent !== oldContent) {
          const diff = generateUnifiedDiff(targetFilePath, oldContent, newContent);
          if (diff) diffs.push(diff);
          if (!dryRun) {
            await writeTextFile(targetFilePath, newContent);
          }
          filesModified.push(targetFilePath);
        }
      }
    }
  } else {
    // JSON catalogs (React, React Native, Next.js, Angular, etc.)
    // Check structure: nested directories (locales/en/common.json) or single files (locales/en.json)
    const directSourceFile = path.join(localeDir, `${sourceLocale}.json`);
    const directTargetFile = path.join(localeDir, `${targetLocale}.json`);

    if (await fileExists(directSourceFile)) {
      const sourceJson = await readJsonFile(directSourceFile);
      if (sourceJson) {
        const pseudoJson = pseudolocalizeObject(sourceJson, pseudoOpts);
        const countKeys = (o: unknown): number =>
          o && typeof o === "object" ? Object.values(o).reduce((acc: number, val) => acc + countKeys(val), typeof o === "object" && !Array.isArray(o) ? 0 : 0) + Object.keys(o).length : 1;
        totalKeysTransformed += countKeys(pseudoJson);

        const newContent = JSON.stringify(pseudoJson, null, 2) + "\n";
        const oldContent = (await fileExists(directTargetFile)) ? (await readTextFile(directTargetFile)) || "" : "";

        if (newContent !== oldContent) {
          const diff = generateUnifiedDiff(directTargetFile, oldContent, newContent);
          if (diff) diffs.push(diff);
          if (!dryRun) {
            await writeJsonFile(directTargetFile, pseudoJson, { spaces: 2 });
          }
          filesModified.push(directTargetFile);
        }
      }
    }

    // Check directory structure: locales/en/*.json
    const sourceLocaleSubdir = path.join(localeDir, sourceLocale);
    if (await fileExists(sourceLocaleSubdir)) {
      const targetLocaleSubdir = path.join(localeDir, targetLocale);
      const nsFiles = await listFiles(sourceLocaleSubdir);

      for (const srcNsFile of nsFiles) {
        if (!srcNsFile.endsWith(".json")) continue;
        const nsName = path.basename(srcNsFile, ".json");
        if (options.namespaces && options.namespaces.length > 0 && !options.namespaces.includes(nsName)) {
          continue;
        }

        const targetNsFile = path.join(targetLocaleSubdir, `${nsName}.json`);
        const sourceJson = await readJsonFile(srcNsFile);
        if (sourceJson) {
          const pseudoJson = pseudolocalizeObject(sourceJson, pseudoOpts);
          const countKeys = (o: unknown): number =>
            o && typeof o === "object" ? Object.keys(o).length : 1;
          totalKeysTransformed += countKeys(pseudoJson);

          const newContent = JSON.stringify(pseudoJson, null, 2) + "\n";
          const oldContent = (await fileExists(targetNsFile)) ? (await readTextFile(targetNsFile)) || "" : "";

          if (newContent !== oldContent) {
            const diff = generateUnifiedDiff(targetNsFile, oldContent, newContent);
            if (diff) diffs.push(diff);
            if (!dryRun) {
              await writeJsonFile(targetNsFile, pseudoJson, { spaces: 2 });
            }
            filesModified.push(targetNsFile);
          }
        }
      }
    }
  }

  logger.info(`Pseudolocalization complete: ${filesModified.length} files affected, ${totalKeysTransformed} keys transformed`);

  return {
    sourceLocale,
    targetLocale,
    filesModified,
    keysTransformed: totalKeysTransformed,
    dryRun,
    diff: diffs.join("\n"),
  };
}
