/**
 * Pluralization helper for detecting count variables, inflecting English nouns,
 * and generating i18next _one and _other plural forms.
 */

const COUNT_NAME_PATTERN =
  /^(count|total|num|quantity|size|length|amount|cnt)$/i;

const COUNT_SUFFIX_PATTERN =
  /(count|total|size|length|amount|items|results|messages|users|files)$/i;

const COUNT_PREFIX_PATTERN =
  /^(num|total|count|item|file|user|result|msg)/i;

/**
 * Determines whether a variable or expression name signifies a quantity/count.
 */
export function isCountIdentifier(name: string, expressionText?: string): boolean {
  const cleanName = name.trim().toLowerCase();

  // 1. Direct match
  if (COUNT_NAME_PATTERN.test(cleanName)) {
    return true;
  }

  // 2. Suffix / prefix matches (e.g. itemCount, unreadCount, totalUsers, numMessages)
  if (COUNT_SUFFIX_PATTERN.test(cleanName) || COUNT_PREFIX_PATTERN.test(cleanName)) {
    return true;
  }

  // 3. Expression check: e.g. items.length, list.size, data.length
  if (expressionText) {
    const cleanExpr = expressionText.trim().toLowerCase();
    if (
      cleanExpr.endsWith(".length") ||
      cleanExpr.endsWith(".size") ||
      cleanExpr.endsWith(".count")
    ) {
      return true;
    }
  }

  return false;
}

const IRREGULAR_SINGULARS: Record<string, string> = {
  children: "child",
  people: "person",
  men: "man",
  women: "woman",
  feet: "foot",
  teeth: "tooth",
  mice: "mouse",
  geese: "goose",
  oxen: "ox",
};

const IRREGULAR_PLURALS: Record<string, string> = {
  child: "children",
  person: "people",
  man: "men",
  woman: "women",
  foot: "feet",
  tooth: "teeth",
  mouse: "mice",
  goose: "geese",
  ox: "oxen",
};

/**
 * Converts a plural English word into singular.
 */
export function singularizeEnglishWord(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_SINGULARS[lower]) {
    const match = IRREGULAR_SINGULARS[lower]!;
    return matchCase(word, match);
  }

  // Do not modify words ending in 'ss', 'us', 'is' (e.g. 'status', 'process', 'business', 'basis')
  if (/(?:ss|us|is)$/i.test(word)) {
    return word;
  }

  // Words ending in 'ies' -> 'y' (e.g. categories -> category, entries -> entry, queries -> query)
  if (/[^aeiou]ies$/i.test(word)) {
    return word.slice(0, -3) + (word.endsWith("IES") ? "Y" : "y");
  }

  // Words ending in 'ves' -> 'f' or 'fe' (e.g. leaves -> leaf, lives -> life, halves -> half)
  if (/ves$/i.test(word)) {
    return word.slice(0, -3) + (word.endsWith("VES") ? "F" : "f");
  }

  // Words ending in 'xes', 'shes', 'ches', 'zes' -> remove 'es'
  if (/(?:x|sh|ch|z)es$/i.test(word)) {
    return word.slice(0, -2);
  }

  // Words ending in 'sses':
  if (/sses$/i.test(word)) {
    return word.slice(0, -2);
  }

  // General plural ending in 's'
  if (/s$/i.test(word) && !/(?:ss|us|is)$/i.test(word)) {
    return word.slice(0, -1);
  }

  return word;
}

/**
 * Converts a singular English word into plural.
 */
export function pluralizeEnglishWord(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) {
    return matchCase(word, IRREGULAR_PLURALS[lower]!);
  }

  // Already plural or ends with 'ss'
  if (/(?:x|s|z|ch|sh)$/i.test(word)) {
    return word + (word.endsWith("S") || word.endsWith("X") ? "ES" : "es");
  }

  // Ends with consonant + y: category -> categories
  if (/[^aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + (word.endsWith("Y") ? "IES" : "ies");
  }

  // Ends with f or fe: leaf -> leaves
  if (/(?:[a-z])f$/i.test(word)) {
    return word.slice(0, -1) + (word.endsWith("F") ? "VES" : "ves");
  }

  return word + (word.endsWith("S") ? "S" : "s");
}

function matchCase(source: string, target: string): string {
  if (source === source.toUpperCase()) {
    return target.toUpperCase();
  }
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1).toLowerCase();
  }
  return target.toLowerCase();
}

/**
 * Derives both `{ one, other }` plural forms from a text template.
 * E.g.:
 * - `derivePluralForms("{{count}} items", "count")` -> { one: "{{count}} item", other: "{{count}} items" }
 * - `derivePluralForms("{{count}} item", "count")` -> { one: "{{count}} item", other: "{{count}} items" }
 */
export function derivePluralForms(
  text: string,
  countVarName = "count"
): { one: string; other: string } {
  const placeholderRegex = new RegExp(`\\{\\{${countVarName}\\}\\}|\\{\\{[^}]+\\}\\}`, "g");
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(text)) !== null) {
    const afterPlaceholder = text.slice(match.index + match[0].length);
    const wordMatches = Array.from(afterPlaceholder.matchAll(/(\s*)([a-zA-Z]+)/g));

    if (wordMatches.length > 0) {
      // Find the noun: prefer a word that is already plural (e.g. 'messages' in 'unread messages')
      // Otherwise, select the last word in the phrase (e.g. 'message' in 'unread message')
      let targetMatch = wordMatches.find((m) => {
        const w = m[2]!;
        return singularizeEnglishWord(w) !== w;
      });

      if (!targetMatch) {
        targetMatch = wordMatches[wordMatches.length - 1]!;
      }

      const word = targetMatch[2]!;
      const matchStart = targetMatch.index!;

      const singular = singularizeEnglishWord(word);
      const plural = pluralizeEnglishWord(singular);

      const prefix = text.slice(0, match.index + match[0].length + matchStart) + targetMatch[1]!;
      const suffix = afterPlaceholder.slice(matchStart + targetMatch[0].length);

      return {
        one: `${prefix}${singular}${suffix}`,
        other: `${prefix}${plural}${suffix}`,
      };
    }
  }

  const wordsMatch = text.match(/^(.*?\b)([a-zA-Z]+)(\b[^\w]*)$/);
  if (wordsMatch && wordsMatch[2]) {
    const prefix = wordsMatch[1]!;
    const word = wordsMatch[2]!;
    const suffix = wordsMatch[3]!;

    const singular = singularizeEnglishWord(word);
    const plural = pluralizeEnglishWord(singular);

    return {
      one: `${prefix}${singular}${suffix}`,
      other: `${prefix}${plural}${suffix}`,
    };
  }

  return {
    one: text,
    other: text,
  };
}
