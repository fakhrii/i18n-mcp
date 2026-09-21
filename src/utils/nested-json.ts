/**
 * Utility functions for safely traversing, querying, and updating nested JSON
 * locale structures without corrupting or flattening schemas.
 */

/**
 * Checks if an object has top-level properties whose values are nested objects
 * (e.g. { PISPI: { ... }, common: { ... } } or { ONBOARDING: { ... } }).
 */
export function isNestedJsonObject(obj: Record<string, unknown>): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  return Object.values(obj).some(
    (val) => typeof val === "object" && val !== null && !Array.isArray(val)
  );
}

/**
 * Finds a property key in an object, first by exact match, then case-insensitively.
 */
export function findMatchingPropertyKey(
  obj: Record<string, unknown>,
  targetKey: string
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(obj, targetKey)) {
    return targetKey;
  }
  const lower = targetKey.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) {
      return k;
    }
  }
  return undefined;
}

/**
 * Retrieves the value at a given key path.
 * Supports:
 * - Direct property: obj["TITLE"]
 * - Dot-separated path: obj["ONBOARDING"]["TITLE"] or obj["PISPI"]["ONBOARDING"]["TITLE"]
 * - Preserves empty strings ("") or null values.
 * - Matches keys case-insensitively when exact key isn't found.
 */
export function getNestedValue(
  obj: Record<string, unknown> | undefined | null,
  keyPath: string
): unknown {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }

  // 1. Direct property check (flat, case-insensitive)
  const directKey = findMatchingPropertyKey(obj, keyPath);
  if (directKey !== undefined) {
    return obj[directKey];
  }

  // 2. Dot-separated path traversal (case-insensitive)
  if (keyPath.includes(".")) {
    const parts = keyPath.split(".");
    let current: any = obj;
    for (const part of parts) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        const matchedKey = findMatchingPropertyKey(current, part);
        if (matchedKey !== undefined) {
          current = current[matchedKey];
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    return current;
  }

  return undefined;
}

/**
 * Checks if a key path exists in the object (even if the value is "" or null).
 */
export function hasNestedKey(
  obj: Record<string, unknown> | undefined | null,
  keyPath: string
): boolean {
  return getNestedValue(obj, keyPath) !== undefined;
}

/**
 * Safely sets a value at a given key path.
 * If keyPath contains dots (e.g. "ONBOARDING.HERO_TITLE"):
 * - If obj already has a flat property "ONBOARDING.HERO_TITLE", updates it flat.
 * - Otherwise, creates intermediate nested objects ({ ONBOARDING: { HERO_TITLE: value } })
 *   WITHOUT deleting any existing sibling keys or parent objects.
 * - Preserves existing key casing where matched.
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown,
  options?: { forceFlat?: boolean }
): void {
  if (!keyPath.includes(".") || options?.forceFlat) {
    const directKey = findMatchingPropertyKey(obj, keyPath) || keyPath;
    obj[directKey] = value;
    return;
  }

  // If object already explicitly contains this as a flat property with dots:
  const flatKey = findMatchingPropertyKey(obj, keyPath);
  if (
    flatKey !== undefined &&
    (typeof obj[flatKey] !== "object" || obj[flatKey] === null)
  ) {
    obj[flatKey] = value;
    return;
  }

  // Otherwise, traverse and create intermediate objects
  const parts = keyPath.split(".");
  let current: any = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const matchedKey = findMatchingPropertyKey(current, part);
    const resolvedKey = matchedKey || part;

    if (
      current[resolvedKey] === undefined ||
      current[resolvedKey] === null ||
      typeof current[resolvedKey] !== "object" ||
      Array.isArray(current[resolvedKey])
    ) {
      current[resolvedKey] = {};
    }
    current = current[resolvedKey];
  }

  const lastPart = parts[parts.length - 1]!;
  const matchedLastKey = findMatchingPropertyKey(current, lastPart);
  const resolvedLastKey = matchedLastKey || lastPart;
  current[resolvedLastKey] = value;
}

/**
 * Recursively flattens a nested object into dot-separated key-value pairs.
 */
export function flattenNestedObject(
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
      const sub = flattenNestedObject(v as Record<string, unknown>, fullKey);
      for (const [subK, subV] of sub.entries()) {
        result.set(subK, subV);
      }
    }
  }

  return result;
}
