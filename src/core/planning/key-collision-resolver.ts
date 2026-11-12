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
import type { KeyNamingStyle } from "../keys/key-generator.js";
import { formatKeyByStyle } from "../keys/key-generator.js";

export function resolveKeyCollision(
  candidateKey: string,
  sourceText: string,
  _namespace: string,
  existingNamespaceKeys: Set<string>,
  existingKeyValues?: Map<string, string>,
  keyStyle: KeyNamingStyle = "UPPER_SNAKE_CASE"
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
  // Strip interpolations, escape codes, variables, and bullets first!
  const cleanText = sourceText
    .replace(/\{\{[^}]+\}\}/g, " ")
    .replace(/\$\{[^}]+\}/g, " ")
    .replace(/\$[a-zA-Z0-9_]+/g, " ")
    .replace(/\\u[0-9a-fA-F]{4}/gi, " ")
    .replace(/\\[nrtfv0]/gi, " ")
    .replace(/[\n\r\t•·\u2022\u25CF–—]/g, " ")
    .trim();

  const words = cleanText
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.toLowerCase());

  if (words.length > 0) {
    for (let len = Math.min(words.length, 6); len >= 2; len--) {
      const longerKey = formatKeyByStyle(words.slice(0, len), keyStyle);
      if (longerKey && !existingNamespaceKeys.has(longerKey)) {
        return { key: longerKey, action: "CREATE" };
      }
    }
  }

  // Second attempt: try full text key
  const fullTextKey = generateSemanticKey(cleanText || sourceText, undefined, keyStyle);
  if (fullTextKey && !existingNamespaceKeys.has(fullTextKey)) {
    return { key: fullTextKey, action: "CREATE" };
  }

  // Third attempt: append incremental suffix respecting keyStyle
  let counter = 2;
  const isCamel = keyStyle === "lowerCamelCase" || keyStyle === "camelCase";
  let suffixedKey = isCamel ? `${candidateKey}${counter}` : `${candidateKey}_${counter}`;
  while (existingNamespaceKeys.has(suffixedKey)) {
    counter++;
    suffixedKey = isCamel ? `${candidateKey}${counter}` : `${candidateKey}_${counter}`;
  }

  return { key: suffixedKey, action: "CREATE" };
}
