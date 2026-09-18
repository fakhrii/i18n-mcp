import * as path from "node:path";
import type { TranslationPlan } from "../../models/plan.js";
import type { ApplyError, ApplyWarning } from "../../models/replacement.js";
import { fileExists, readTextFile, toPosixPath } from "../../utils/file-system.js";

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
 * Prepares in-memory updates for locale files based on the migration plan.
 */
export async function prepareLocaleUpdates(
  projectRoot: string,
  translations: TranslationPlan[]
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
      if (Object.prototype.hasOwnProperty.call(parsed, entry.key)) {
        const existingVal = parsed[entry.key];
        if (existingVal !== entry.sourceLocale.value) {
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
        // If exact same value already present, no conflict
        continue;
      }

      parsed[entry.key] = entry.sourceLocale.value;
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
