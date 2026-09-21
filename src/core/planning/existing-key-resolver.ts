import * as path from "node:path";
import type { MatchType, PlanAction } from "../../models/plan.js";
import {
  dirExists,
  fileExists,
  listFiles,
  readJsonFile,
  toPosixPath,
} from "../../utils/file-system.js";

export interface ExistingTranslationItem {
  namespace: string;
  key: string;
  value: string;
  normalizedValue: string;
  sourceFile: string;
}

export interface ExistingTranslations {
  items: ExistingTranslationItem[];
  byNamespace: Map<string, Map<string, string>>;
  commonItems: ExistingTranslationItem[];
}

export interface ExistingKeyMatchResult {
  action: PlanAction;
  matchType: MatchType;
  confidence: number;
  namespace?: string;
  key?: string;
  existingText?: string;
}

/**
 * Normalizes text for comparison: lowercase, collapses whitespace, removes edge punctuation.
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "") // trim surrounding quotes
    .replace(/[.!?…:;,]+$/g, "") // trim trailing punctuation
    .replace(/^[.!?…:;,]+/g, "") // trim leading punctuation
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "your",
  "my",
  "our",
  "this",
  "that",
  "please",
]);

/**
 * Extracts normalized word tokens ignoring minor stop words.
 */
export function extractMeaningfulTokens(text: string): string[] {
  const norm = normalizeText(text);
  return norm
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Computes Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Computes conservative semantic similarity between two texts.
 * Returns a score between 0 and 1.
 */
export function computeSemanticSimilarity(textA: string, textB: string): number {
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);

  if (normA === normB) return 1.0;

  // Jaccard similarity on meaningful tokens
  const tokensA = extractMeaningfulTokens(normA);
  const tokensB = extractMeaningfulTokens(normB);

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  if (setA.size === 0 || setB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }
  const unionCount = new Set([...setA, ...setB]).size;
  const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0.0;

  // Normalized Levenshtein similarity
  const maxLen = Math.max(normA.length, normB.length);
  const levDist = levenshteinDistance(normA, normB);
  const levSim = maxLen > 0 ? Math.max(0, 1 - levDist / maxLen) : 0.0;

  // Conservative weighted combination: token overlap is primary, string edit distance secondary
  const score = jaccard * 0.6 + levSim * 0.4;
  return Math.round(score * 100) / 100;
}

/**
 * Recursively flattens nested translation objects to dot-notation keys.
 */
function flattenTranslations(
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
      const sub = flattenTranslations(v as Record<string, unknown>, fullKey);
      for (const [subK, subV] of sub.entries()) {
        result.set(subK, subV);
      }
    }
  }

  return result;
}

/**
 * Loads existing translations from the project's source locale files.
 */
export async function loadExistingTranslations(
  projectRoot: string,
  localeDirectory?: string | null,
  sourceLocale = "en"
): Promise<ExistingTranslations> {
  const items: ExistingTranslationItem[] = [];
  const byNamespace = new Map<string, Map<string, string>>();
  const commonItems: ExistingTranslationItem[] = [];

  if (!localeDirectory) {
    return { items, byNamespace, commonItems };
  }

  const fullLocaleDir = path.join(projectRoot, localeDirectory);
  if (!(await dirExists(fullLocaleDir))) {
    return { items, byNamespace, commonItems };
  }

  // Check subfolder per locale: e.g. locales/en/*.json
  const sourceLocaleSubdir = path.join(fullLocaleDir, sourceLocale);
  if (await dirExists(sourceLocaleSubdir)) {
    const files = await listFiles(sourceLocaleSubdir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const ns = path.basename(f, ".json");
      const filePath = path.join(sourceLocaleSubdir, f);
      const content = await readJsonFile<Record<string, unknown>>(filePath);
      if (!content) continue;

      const flat = flattenTranslations(content);
      const nsMap = byNamespace.get(ns) || new Map<string, string>();
      byNamespace.set(ns, nsMap);

      for (const [key, val] of flat.entries()) {
        nsMap.set(key, val);
        const item: ExistingTranslationItem = {
          namespace: ns,
          key,
          value: val,
          normalizedValue: normalizeText(val),
          sourceFile: toPosixPath(path.relative(projectRoot, filePath)),
        };
        items.push(item);
        if (ns === "common") {
          commonItems.push(item);
        }
      }
    }
  } else {
    // Check single file per locale: e.g. locales/en.json
    const singleFile = path.join(fullLocaleDir, `${sourceLocale}.json`);
    if (await fileExists(singleFile)) {
      const content = await readJsonFile<Record<string, unknown>>(singleFile);
      if (content) {
        // If top-level values are objects, treat top keys as namespaces
        let hasNamespaces = false;
        for (const [k, v] of Object.entries(content)) {
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            hasNamespaces = true;
            const nsFlat = flattenTranslations(v as Record<string, unknown>);
            const nsMap = byNamespace.get(k) || new Map<string, string>();
            byNamespace.set(k, nsMap);

            for (const [subK, subV] of nsFlat.entries()) {
              nsMap.set(subK, subV);
              const item: ExistingTranslationItem = {
                namespace: k,
                key: subK,
                value: subV,
                normalizedValue: normalizeText(subV),
                sourceFile: toPosixPath(path.relative(projectRoot, singleFile)),
              };
              items.push(item);
              if (k === "common") {
                commonItems.push(item);
              }
            }
          }
        }

        if (!hasNamespaces) {
          const ns = "common";
          const nsMap = byNamespace.get(ns) || new Map<string, string>();
          byNamespace.set(ns, nsMap);
          const flat = flattenTranslations(content);
          for (const [key, val] of flat.entries()) {
            nsMap.set(key, val);
            const item: ExistingTranslationItem = {
              namespace: ns,
              key,
              value: val,
              normalizedValue: normalizeText(val),
              sourceFile: toPosixPath(path.relative(projectRoot, singleFile)),
            };
            items.push(item);
            commonItems.push(item);
          }
        }
      }
    }
  }

  return { items, byNamespace, commonItems };
}

/**
 * Searches existing translations for a detected string following strict hierarchy:
 * 1. common namespace (exact & normalized)
 * 2. preferred namespace (exact & normalized)
 * 3. all other namespaces (exact & normalized)
 * 4. conservative semantic matching (threshold >= 0.85)
 */
export function resolveExistingTranslation(
  detectedText: string,
  preferredNamespace: string,
  existing: ExistingTranslations,
  semanticThreshold = 0.85
): ExistingKeyMatchResult {
  const trimmed = detectedText.trim();
  const normalized = normalizeText(trimmed);

  // 1. Check 'common' namespace for EXACT match
  for (const item of existing.commonItems) {
    if (item.value.trim() === trimmed) {
      return {
        action: "REUSE",
        matchType: "EXACT",
        confidence: 1.0,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 2. Check 'common' namespace for NORMALIZED match
  for (const item of existing.commonItems) {
    if (item.normalizedValue === normalized) {
      return {
        action: "REUSE",
        matchType: "NORMALIZED",
        confidence: 0.95,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 3. Check preferred namespace for EXACT match
  const prefItems = existing.items.filter((i) => i.namespace === preferredNamespace);
  for (const item of prefItems) {
    if (item.value.trim() === trimmed) {
      return {
        action: "REUSE",
        matchType: "EXACT",
        confidence: 1.0,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 4. Check preferred namespace for NORMALIZED match
  for (const item of prefItems) {
    if (item.normalizedValue === normalized) {
      return {
        action: "REUSE",
        matchType: "NORMALIZED",
        confidence: 0.95,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 5. Check all other namespaces for EXACT match
  for (const item of existing.items) {
    if (item.namespace === "common" || item.namespace === preferredNamespace) continue;
    if (item.value.trim() === trimmed) {
      return {
        action: "REUSE",
        matchType: "EXACT",
        confidence: 1.0,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 6. Check all other namespaces for NORMALIZED match
  for (const item of existing.items) {
    if (item.namespace === "common" || item.namespace === preferredNamespace) continue;
    if (item.normalizedValue === normalized) {
      return {
        action: "REUSE",
        matchType: "NORMALIZED",
        confidence: 0.95,
        namespace: item.namespace,
        key: item.key,
        existingText: item.value,
      };
    }
  }

  // 7. Conservative SEMANTIC matching
  // First search common, then preferred namespace, then rest
  let bestMatch: ExistingTranslationItem | null = null;
  let bestScore = 0;

  // Search in priority order
  const orderedItems = [
    ...existing.commonItems,
    ...prefItems,
    ...existing.items.filter(
      (i) => i.namespace !== "common" && i.namespace !== preferredNamespace
    ),
  ];

  for (const item of orderedItems) {
    const sim = computeSemanticSimilarity(trimmed, item.value);
    if (sim > bestScore) {
      bestScore = sim;
      bestMatch = item;
    }
  }

  if (bestMatch && bestScore >= semanticThreshold) {
    return {
      action: "REUSE",
      matchType: "SEMANTIC",
      confidence: bestScore,
      namespace: bestMatch.namespace,
      key: bestMatch.key,
      existingText: bestMatch.value,
    };
  }

  // No acceptable match -> GENERATE new key
  return {
    action: "CREATE",
    matchType: "NONE",
    confidence: 0.0,
  };
}
