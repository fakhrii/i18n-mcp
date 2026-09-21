import { generateSemanticKey } from "../keys/key-generator.js";
import { normalizeText, computeSemanticSimilarity } from "./existing-key-resolver.js";

export interface KeyCollisionResolution {
  key: string;
  action: "CREATE" | "REUSE";
  reusedExisting?: boolean;
}

/**
 * Resolves potential key collisions within a namespace.
 * - If key does not exist: accepts candidateKey.
 * - If key exists and text has the same meaning: reuses existing key.
 * - If key exists with different text/meaning: generates a differentiated unique key.
 */
export function resolveKeyCollision(
  candidateKey: string,
  sourceText: string,
  _namespace: string,
  existingNamespaceKeys: Set<string>,
  existingKeyValues?: Map<string, string>
): KeyCollisionResolution {
  // 1. If key is not in use in this namespace, use it as is
  if (!existingNamespaceKeys.has(candidateKey)) {
    return { key: candidateKey, action: "CREATE" };
  }

  // 2. If key exists, check if the existing value means the same thing
  if (existingKeyValues && existingKeyValues.has(candidateKey)) {
    const existingVal = existingKeyValues.get(candidateKey)!;
    const normalizedSource = normalizeText(sourceText);
    const normalizedExisting = normalizeText(existingVal);

    if (normalizedSource === normalizedExisting) {
      return { key: candidateKey, action: "REUSE", reusedExisting: true };
    }

    // If existing value is an empty placeholder, reuse this key to populate it cleanly
    if (existingVal.trim().length === 0) {
      return { key: candidateKey, action: "CREATE", reusedExisting: true };
    }

    // Conservative check: if semantic similarity is very high (>= 0.90), consider it identical
    if (computeSemanticSimilarity(sourceText, existingVal) >= 0.9) {
      return { key: candidateKey, action: "REUSE", reusedExisting: true };
    }
  }

  // 3. Semantic collision: Differentiate key
  // First attempt: generate key using full source text with more words
  const words = sourceText
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());

  // Try candidate combinations from words
  for (let len = Math.min(words.length, 6); len >= 2; len--) {
    const longerKey = words.slice(0, len).join("_");
    if (longerKey && !existingNamespaceKeys.has(longerKey)) {
      return { key: longerKey, action: "CREATE" };
    }
  }

  // Second attempt: try full text key
  const fullTextKey = generateSemanticKey(sourceText);
  if (fullTextKey && !existingNamespaceKeys.has(fullTextKey)) {
    return { key: fullTextKey, action: "CREATE" };
  }

  // Third attempt: append incremental suffix
  let counter = 2;
  let suffixedKey = `${candidateKey}_${counter}`;
  while (existingNamespaceKeys.has(suffixedKey)) {
    counter++;
    suffixedKey = `${candidateKey}_${counter}`;
  }

  return { key: suffixedKey, action: "CREATE" };
}
