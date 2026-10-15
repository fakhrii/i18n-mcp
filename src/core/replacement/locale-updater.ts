import * as path from "node:path";
import type { TranslationPlan } from "../../models/plan.js";
import type { I18nStructureType } from "../../models/project.js";
import type { ApplyError, ApplyWarning } from "../../models/replacement.js";
import { fileExists, readTextFile, toPosixPath } from "../../utils/file-system.js";
import { getNestedValue, setNestedValue } from "../../utils/nested-json.js";
import {
  isArbFile,
  parseArb,
  serializeArb,
  setArbEntry,
  formatIcuPlural,
} from "../locale/arb-handler.js";

export interface LocaleUpdateResult {
  stagedFiles: Map<string, string>; // relative path -> new content
  translationEntriesCreated: number;
  translationsPending: number;
  warnings: ApplyWarning[];
  errors: ApplyError[];
}

/**
 * Detects indentation style used in a JSON string.
 */
function detectIndentation(jsonString: string): string {
  const match = jsonString.match(/^[ \t]+(?=")/m);
  return match ? match[0] : "  ";
}

/**
 * Resolves the appropriate path within the JSON object to place the translation key.
 */
function resolveTargetKeyPath(
  parsed: Record<string, unknown>,
  namespace: string,
  key: string,
  relPath?: string,
  structureType?: I18nStructureType
): string {
  // If the file itself is the namespace file (e.g. locales/en/common.json or locales/en/pispi.json)
  const isNamespaceFile =
    relPath &&
    path.basename(relPath, ".json").toLowerCase() === namespace.toLowerCase();

  if (isNamespaceFile) {
    // If key erroneously includes namespace prefix (e.g. "pispi.ONBOARDING.TITLE"), strip it
    if (key.toLowerCase().startsWith(`${namespace.toLowerCase()}.`)) {
      return key.slice(namespace.length + 1);
    }
    return key;
  }

  // Explicit nested structure
  if (structureType === "nested") {
    if (namespace && namespace !== "translation" && namespace !== "default") {
      if (key.toLowerCase().startsWith(`${namespace.toLowerCase()}.`)) {
        return key;
      }
      return `${namespace}.${key}`;
    }
    return key;
  }

  // Explicit flat structure
  if (structureType === "flat") {
    return key;
  }

  // Otherwise, it's a multi-namespace file (e.g. locales/en.json) or single-file layout:
  // 1. If key already exists in parsed directly (e.g. getNestedValue(parsed, key) !== undefined)
  if (getNestedValue(parsed, key) !== undefined) {
    return key;
  }

  // 2. If key exists with namespace prefix: e.g. getNestedValue(parsed, `${namespace}.${key}`) !== undefined
  const namespacedPath = `${namespace}.${key}`;
  if (getNestedValue(parsed, namespacedPath) !== undefined) {
    return namespacedPath;
  }

  // 3. If key already starts with `${namespace}.`:
  if (key.toLowerCase().startsWith(`${namespace.toLowerCase()}.`)) {
    return key;
  }

  // 4. Check if parsed has top-level namespace object for this namespace (case-insensitive)
  const matchedNsKey = Object.keys(parsed).find(
    (k) => k.toLowerCase() === namespace.toLowerCase()
  );
  if (matchedNsKey) {
    return `${matchedNsKey}.${key}`;
  }

  // 5. If parsed has top-level namespace objects, nest under namespace
  const hasTopLevelNamespaces = Object.values(parsed).some(
    (v) => typeof v === "object" && v !== null && !Array.isArray(v)
  );

  if (hasTopLevelNamespaces) {
    return `${namespace}.${key}`;
  }

  // 6. Default to key
  return key;
}

/**
 * Prepares in-memory updates for locale files based on the migration plan.
 */
export async function prepareLocaleUpdates(
  projectRoot: string,
  translations: TranslationPlan[],
  structureType?: I18nStructureType
): Promise<LocaleUpdateResult> {
  const stagedFiles = new Map<string, string>();
  const warnings: ApplyWarning[] = [];
  const errors: ApplyError[] = [];
  let translationEntriesCreated = 0;
  let translationsPending = 0;

  // Group translations to create by their target source file path
  // Key: relative file path -> TranslationPlan[]
  const plansByFile = new Map<string, TranslationPlan[]>();

  for (const t of translations) {
    // Count pending target translations
    for (const tgt of t.targets) {
      if (tgt.action === "CREATE_TRANSLATION") {
        translationsPending++;
      }
    }

    if (t.action === "CREATE") {
      const relPath = t.sourceLocale.filePath;
      if (!relPath) continue;
      const list = plansByFile.get(relPath) || [];
      list.push(t);
      plansByFile.set(relPath, list);
    }
  }

  for (const [relPath, newEntries] of plansByFile.entries()) {
    const absPath = path.join(projectRoot, relPath);
    let currentContent = "{}";
    let indent = "  ";

    if (await fileExists(absPath)) {
      currentContent = (await readTextFile(absPath)) || "{}";
      indent = detectIndentation(currentContent);
    }

    if (isArbFile(relPath)) {
      let arb;
      try {
        arb = parseArb(currentContent);
      } catch {
        errors.push({
          code: "MALFORMED_LOCALE_JSON",
          message: `ARB file contains invalid JSON: ${toPosixPath(relPath)}`,
          file: toPosixPath(relPath),
        });
        continue;
      }

      let entriesAdded = 0;
      for (const entry of newEntries) {
        if (entry.isPlural && entry.pluralForm) {
          const icuVal = formatIcuPlural(entry.pluralForm, entry.pluralVariable || "count");
          setArbEntry(arb, entry.key, icuVal, { description: `Plural translation for ${entry.key}` });
          entriesAdded++;
          translationEntriesCreated++;
        } else {
          setArbEntry(arb, entry.key, entry.sourceLocale.value, { description: `Translation for ${entry.key}` });
          entriesAdded++;
          translationEntriesCreated++;
        }
      }

      if (entriesAdded > 0) {
        stagedFiles.set(toPosixPath(relPath), serializeArb(arb, indent));
      }
      continue;
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(currentContent);
    } catch {
      errors.push({
        code: "MALFORMED_LOCALE_JSON",
        message: `Locale file contains invalid JSON: ${toPosixPath(relPath)}`,
        file: toPosixPath(relPath),
      });
      continue;
    }

    let entriesAdded = 0;
    for (const entry of newEntries) {
      if (entry.isPlural && entry.pluralForm) {
        const pathOne = resolveTargetKeyPath(parsed, entry.namespace, `${entry.key}_one`, relPath, structureType);
        const pathOther = resolveTargetKeyPath(parsed, entry.namespace, `${entry.key}_other`, relPath, structureType);

        setNestedValue(parsed, pathOne, entry.pluralForm.one);
        setNestedValue(parsed, pathOther, entry.pluralForm.other);
        entriesAdded += 2;
        translationEntriesCreated += 2;
        continue;
      }

      const targetPath = resolveTargetKeyPath(parsed, entry.namespace, entry.key, relPath, structureType);
      const existingVal = getNestedValue(parsed, targetPath);

      if (existingVal !== undefined) {
        // If already identical to planned value, skip
        if (existingVal === entry.sourceLocale.value) {
          continue;
        }

        // If existing value was an empty placeholder, populate it cleanly in-place
        if (typeof existingVal === "string" && existingVal.trim().length === 0) {
          setNestedValue(parsed, targetPath, entry.sourceLocale.value);
          entriesAdded++;
          translationEntriesCreated++;
          continue;
        }

        // If existing value is non-empty string and differs, report conflict
        if (typeof existingVal === "string" && existingVal.trim().length > 0) {
          errors.push({
            code: "KEY_CONFLICT",
            message: `Key collision in ${entry.namespace}:${entry.key}. Existing: "${String(existingVal)}", Planned: "${entry.sourceLocale.value}"`,
            file: toPosixPath(relPath),
            details: {
              namespace: entry.namespace,
              key: entry.key,
              existing: existingVal,
              planned: entry.sourceLocale.value,
            },
          });
          continue;
        }

        // If existing value is an object (key collided with an existing section)
        if (typeof existingVal === "object" && existingVal !== null) {
          errors.push({
            code: "KEY_CONFLICT",
            message: `Key collision in ${entry.namespace}:${entry.key}. Key collides with an existing object node.`,
            file: toPosixPath(relPath),
            details: {
              namespace: entry.namespace,
              key: entry.key,
              existing: "[Object]",
              planned: entry.sourceLocale.value,
            },
          });
          continue;
        }
      }

      setNestedValue(parsed, targetPath, entry.sourceLocale.value);
      entriesAdded++;
      translationEntriesCreated++;
    }

    if (entriesAdded > 0) {
      try {
        const serialized = JSON.stringify(parsed, null, indent) + "\n";
        // Validate staged content parses back cleanly
        JSON.parse(serialized);
        stagedFiles.set(toPosixPath(relPath), serialized);
      } catch (err: unknown) {
        errors.push({
          code: "SERIALIZATION_FAILED",
          message: `Failed to serialize modified JSON for ${relPath}: ${String(err)}`,
          file: toPosixPath(relPath),
        });
      }
    }
  }

  return {
    stagedFiles,
    translationEntriesCreated,
    translationsPending,
    warnings,
    errors,
  };
}
