/**
 * Flutter ARB (Application Resource Bundle) Handler
 * Parses, updates, and serializes .arb localization catalogs.
 */

export interface ArbKeyMetadata {
  description?: string;
  placeholders?: Record<
    string,
    {
      type?: string;
      example?: string;
      format?: string;
    }
  >;
}

export interface ArbFile {
  locale?: string;
  globalMetadata: Record<string, unknown>;
  entries: Map<string, string>;
  keyMetadata: Map<string, ArbKeyMetadata>;
}

/**
 * Checks whether a given file path is an ARB file.
 */
export function isArbFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".arb");
}

/**
 * Parses an ARB JSON string into a structured ArbFile.
 */
export function parseArb(content: string): ArbFile {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    throw new Error(`Failed to parse ARB JSON: ${String(err)}`);
  }

  let locale: string | undefined;
  const globalMetadata: Record<string, unknown> = {};
  const entries = new Map<string, string>();
  const keyMetadata = new Map<string, ArbKeyMetadata>();

  for (const [k, v] of Object.entries(parsed)) {
    if (k === "@@locale") {
      locale = String(v);
      globalMetadata[k] = v;
    } else if (k.startsWith("@@")) {
      globalMetadata[k] = v;
    } else if (k.startsWith("@")) {
      const targetKey = k.slice(1);
      if (typeof v === "object" && v !== null) {
        keyMetadata.set(targetKey, v as ArbKeyMetadata);
      }
    } else {
      entries.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  return {
    locale,
    globalMetadata,
    entries,
    keyMetadata,
  };
}

/**
 * Serializes an ArbFile back into formatted JSON with indentation.
 */
export function serializeArb(arb: ArbFile, indent = "  "): string {
  const resultObj: Record<string, unknown> = {};

  // 1. Output global metadata (@@locale first)
  if (arb.locale) {
    resultObj["@@locale"] = arb.locale;
  }
  for (const [k, v] of Object.entries(arb.globalMetadata)) {
    if (k !== "@@locale") {
      resultObj[k] = v;
    }
  }

  // 2. Output key and its @key metadata together
  for (const [key, value] of arb.entries.entries()) {
    resultObj[key] = value;
    const meta = arb.keyMetadata.get(key);
    if (meta) {
      resultObj[`@${key}`] = meta;
    }
  }

  return JSON.stringify(resultObj, null, indent) + "\n";
}

/**
 * Converts a plural form dictionary { one, other } into an ICU MessageFormat plural string.
 * e.g. "{count, plural, =1{1 item} other{{count} items}}"
 */
export function formatIcuPlural(
  pluralForm: { one: string; other: string },
  countVar = "count"
): string {
  const oneText = pluralForm.one.replace(/\{\{count\}\}/g, `{${countVar}}`);
  const otherText = pluralForm.other.replace(/\{\{count\}\}/g, `{${countVar}}`);
  return `{${countVar}, plural, =1{${oneText}} other{${otherText}}}`;
}

/**
 * Adds or updates a translation entry in the ArbFile.
 */
export function setArbEntry(
  arb: ArbFile,
  key: string,
  value: string,
  meta?: ArbKeyMetadata
): void {
  // Convert {{var}} interpolation to {var} for Flutter ARB syntax
  const arbValue = value.replace(/\{\{([^}]+)\}\}/g, "{$1}");
  arb.entries.set(key, arbValue);

  if (meta) {
    arb.keyMetadata.set(key, meta);
  } else if (!arb.keyMetadata.has(key)) {
    // Extract placeholders if any
    const placeholders: Record<string, { type: string }> = {};
    const matches = arbValue.match(/\{([a-zA-Z0-9_]+)\}/g);
    if (matches) {
      for (const m of matches) {
        const v = m.slice(1, -1);
        if (v !== "count") {
          placeholders[v] = { type: "String" };
        } else {
          placeholders[v] = { type: "num" };
        }
      }
    }

    arb.keyMetadata.set(key, {
      description: `Translation for ${key}`,
      ...(Object.keys(placeholders).length > 0 ? { placeholders } : {}),
    });
  }
}
