import type { CldrPluralCategory } from "../../models/plural.js";

export const ALL_CLDR_CATEGORIES: CldrPluralCategory[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

const STATIC_FALLBACK_TABLE: Record<string, CldrPluralCategory[]> = {
  // 6 categories
  ar: ["zero", "one", "two", "few", "many", "other"],
  cy: ["zero", "one", "two", "few", "many", "other"],

  // 4 categories (one, few, many, other)
  ru: ["one", "few", "many", "other"],
  uk: ["one", "few", "many", "other"],
  be: ["one", "few", "many", "other"],
  pl: ["one", "few", "many", "other"],
  ga: ["one", "two", "few", "many", "other"],
  mt: ["one", "two", "few", "many", "other"],

  // 3 categories (one, few, other)
  cs: ["one", "few", "other"],
  sk: ["one", "few", "other"],
  hr: ["one", "few", "other"],
  sr: ["one", "few", "other"],
  bs: ["one", "few", "other"],
  lt: ["one", "few", "other"],
  lv: ["zero", "one", "other"],
  ro: ["one", "few", "other"],
  mo: ["one", "few", "other"],
  sl: ["one", "two", "few", "other"],

  // 1 category (other only)
  ja: ["other"],
  zh: ["other"],
  ko: ["other"],
  vi: ["other"],
  th: ["other"],
  id: ["other"],
  tr: ["other"],
  fa: ["other"],
  ms: ["other"],
  my: ["other"],
};

/**
 * Returns the required CLDR plural categories for a given locale code (e.g. 'en', 'ar', 'ru', 'fr', 'zh-CN').
 * Uses V8 / Node.js native Intl.PluralRules when available, with rock-solid static CLDR table fallback.
 */
export function getRequiredPluralCategories(locale: string): CldrPluralCategory[] {
  const norm = locale.toLowerCase().replace(/_/g, "-");
  const baseLang = norm.split("-")[0] || norm;

  try {
    const pr = new Intl.PluralRules(norm);
    const resolved = pr.resolvedOptions().pluralCategories as CldrPluralCategory[];
    if (resolved && resolved.length > 0) {
      const categories = [...resolved];
      // In ICU MessageFormat, 'other' is mandatory as the universal catch-all branch
      if (!categories.includes("other")) {
        categories.push("other");
      }
      return sortCategories(categories);
    }
  } catch {
    // Fall back to static lookup
  }

  const fallback = STATIC_FALLBACK_TABLE[norm] || STATIC_FALLBACK_TABLE[baseLang];
  if (fallback) {
    return sortCategories(fallback);
  }

  // Universal default for Germanic, Romance, and most Western languages (one, other)
  return ["one", "other"];
}

/**
 * Sorts plural categories in natural CLDR order: zero -> one -> two -> few -> many -> other.
 */
export function sortCategories(categories: CldrPluralCategory[]): CldrPluralCategory[] {
  return [...categories].sort((a, b) => {
    return ALL_CLDR_CATEGORIES.indexOf(a) - ALL_CLDR_CATEGORIES.indexOf(b);
  });
}

/**
 * Checks whether a branch selector is a valid CLDR category or an exact numeric selector (=0, =1, etc.).
 */
export function isValidPluralSelector(selector: string): boolean {
  if (ALL_CLDR_CATEGORIES.includes(selector as CldrPluralCategory)) {
    return true;
  }
  return /^=[0-9]+$/.test(selector);
}
