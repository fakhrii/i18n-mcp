/**
 * Apple Xcode 15+ String Catalogs (.xcstrings) Handler.
 * Parses, queries, updates, and serializes Apple String Catalog files.
 */

export interface XCStringUnit {
  state?: "translated" | "needs_review" | "new" | "stale";
  value: string;
}

export interface XCStringVariation {
  stringUnit: XCStringUnit;
}

export interface XCLocalization {
  stringUnit?: XCStringUnit;
  variations?: {
    plural?: Record<string, XCStringVariation>;
    device?: Record<string, XCStringVariation>;
  };
  substitutions?: Record<string, unknown>;
}

export interface XCStringEntry {
  comment?: string;
  extractionState?: "manual" | "migrated" | "extracted_with_value" | "stale";
  localizations?: Record<string, XCLocalization>;
}

export interface XCStringCatalog {
  sourceLanguage: string;
  strings: Record<string, XCStringEntry>;
  version: string;
}

/**
 * Checks whether a file path points to an Apple String Catalog (.xcstrings).
 */
export function isXCStringsFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".xcstrings");
}

/**
 * Parses JSON content of an .xcstrings file into a typed XCStringCatalog.
 */
export function parseXCStrings(content: string): XCStringCatalog {
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    throw new Error(`Failed to parse .xcstrings JSON: ${String(err)}`);
  }

  return {
    sourceLanguage: parsed.sourceLanguage || "en",
    strings: parsed.strings || {},
    version: parsed.version || "1.0",
  };
}

/**
 * Serializes an XCStringCatalog back into structured, indented JSON.
 */
export function serializeXCStrings(catalog: XCStringCatalog, indent = "  "): string {
  // Sort strings keys alphabetically for clean git diffs
  const sortedStrings: Record<string, XCStringEntry> = {};
  for (const key of Object.keys(catalog.strings).sort()) {
    sortedStrings[key] = catalog.strings[key]!;
  }

  const outputObj = {
    sourceLanguage: catalog.sourceLanguage,
    strings: sortedStrings,
    version: catalog.version,
  };

  return JSON.stringify(outputObj, null, indent) + "\n";
}

/**
 * Retrieves a translated string value for a given key and locale from an XCStringCatalog.
 */
export function getXCStringValue(
  catalog: XCStringCatalog,
  key: string,
  locale: string
): string | undefined {
  const entry = catalog.strings[key];
  if (!entry || !entry.localizations) return undefined;

  const loc = entry.localizations[locale] || entry.localizations[locale.toLowerCase()];
  if (!loc) return undefined;

  return loc.stringUnit?.value;
}

/**
 * Sets or updates a translated string value for a given key and locale in an XCStringCatalog.
 */
export function setXCStringValue(
  catalog: XCStringCatalog,
  key: string,
  locale: string,
  value: string,
  comment?: string,
  state: "translated" | "needs_review" | "new" = "translated"
): void {
  if (!catalog.strings[key]) {
    catalog.strings[key] = {
      extractionState: "manual",
      localizations: {},
    };
  }

  const entry = catalog.strings[key]!;
  if (comment && !entry.comment) {
    entry.comment = comment;
  }

  if (!entry.localizations) {
    entry.localizations = {};
  }

  if (!entry.localizations[locale]) {
    entry.localizations[locale] = {};
  }

  entry.localizations[locale]!.stringUnit = {
    state,
    value,
  };
}

/**
 * Retrieves plural variations for a given key and locale from an XCStringCatalog.
 */
export function getXCStringPlurals(
  catalog: XCStringCatalog,
  key: string,
  locale: string
): Record<string, string> | undefined {
  const entry = catalog.strings[key];
  if (!entry?.localizations) return undefined;

  const loc = entry.localizations[locale] || entry.localizations[locale.toLowerCase()];
  const plurals = loc?.variations?.plural;
  if (!plurals) return undefined;

  const result: Record<string, string> = {};
  for (const [category, variation] of Object.entries(plurals)) {
    result[category] = variation.stringUnit.value;
  }
  return result;
}

/**
 * Sets a plural variation in an XCStringCatalog.
 */
export function setXCStringPlural(
  catalog: XCStringCatalog,
  key: string,
  locale: string,
  category: string,
  value: string,
  comment?: string
): void {
  if (!catalog.strings[key]) {
    catalog.strings[key] = {
      extractionState: "manual",
      localizations: {},
    };
  }

  const entry = catalog.strings[key]!;
  if (comment && !entry.comment) {
    entry.comment = comment;
  }

  if (!entry.localizations) {
    entry.localizations = {};
  }

  if (!entry.localizations[locale]) {
    entry.localizations[locale] = {};
  }

  const loc = entry.localizations[locale]!;
  if (!loc.variations) {
    loc.variations = {};
  }
  if (!loc.variations.plural) {
    loc.variations.plural = {};
  }

  loc.variations.plural[category] = {
    stringUnit: {
      state: "translated",
      value,
    },
  };
}
