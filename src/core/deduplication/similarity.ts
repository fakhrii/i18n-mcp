/**
 * String similarity and normalization algorithms for deduplication.
 */

import { levenshteinDistance } from "../planning/existing-key-resolver.js";

/**
 * Normalizes text for similarity comparison:
 * - Lowercases text
 * - Strips leading/trailing and interior quotation marks
 * - Strips punctuation (. , ! ? ; : - _ / \)
 * - Collapses consecutive whitespace
 */
export function normalizeForSimilarity(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\\+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculates string similarity ratio between 0.0 (totally different) and 1.0 (exact match).
 */
export function calculateStringSimilarity(strA: string, strB: string): number {
  if (strA === strB) return 1.0;
  if (!strA || !strB) return 0.0;

  const normA = normalizeForSimilarity(strA);
  const normB = normalizeForSimilarity(strB);

  if (normA === normB) return 1.0;
  if (normA.length === 0 || normB.length === 0) return 0.0;

  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);

  return Math.max(0, 1.0 - dist / maxLen);
}
