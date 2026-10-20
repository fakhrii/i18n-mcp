import * as path from "node:path";
import {
  fileExists,
  listDirectories,
  listFiles,
  readTextFile,
  writeTextFile,
} from "../../utils/file-system.js";
import { isArbFile, parseArb, serializeArb } from "../locale/arb-handler.js";
import { deleteNestedValue } from "../../utils/nested-json.js";

export interface UnusedKeyInfo {
  namespace: string;
  key: string;
  sourceFile?: string;
}

export interface DeadKeyScanResult {
  unusedKeys: UnusedKeyInfo[];
  usedKeysCount: number;
  totalKeysCount: number;
}

/**
 * Extracts all translation key references from a source file's text.
 */
export function extractReferencedKeysFromSource(sourceContent: string): Set<string> {
  const referencedKeys = new Set<string>();

  // 1. Match t("KEY"), t('KEY'), t(`KEY`), i18n.t("KEY"), translate("KEY")
  const tCallRegex =
    /\b(?:t|i18n\.t|translate)\s*\(\s*(['"`])([a-zA-Z0-9_.:/-]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = tCallRegex.exec(sourceContent)) !== null) {
    const rawKey = match[2];
    if (rawKey) {
      referencedKeys.add(rawKey);
      // If colon or dot namespaced: 'auth:LOGIN' or 'auth.LOGIN'
      if (rawKey.includes(":")) {
        const parts = rawKey.split(":");
        referencedKeys.add(parts[1]!);
      }
      if (rawKey.includes(".")) {
        const parts = rawKey.split(".");
        referencedKeys.add(parts[parts.length - 1]!);
      }
    }
  }

  // 2. Match <Trans i18nKey="KEY" ...>
  const transRegex = /<Trans[^>]*\bi18nKey=(['"])([^'"]+)\1/g;
  while ((match = transRegex.exec(sourceContent)) !== null) {
    const rawKey = match[2];
    if (rawKey) {
      referencedKeys.add(rawKey);
      if (rawKey.includes(":")) {
        referencedKeys.add(rawKey.split(":")[1]!);
      }
    }
  }

  // 3. Match Flutter l10n.keyName or AppLocalizations.of(context)!.keyName
  const flutterL10nRegex = /(?:l10n|AppLocalizations\.of\(context\)[!?]?)\.([a-zA-Z0-9_]+)/g;
  while ((match = flutterL10nRegex.exec(sourceContent)) !== null) {
    if (match[1]) {
      referencedKeys.add(match[1]);
    }
  }

  return referencedKeys;
}

/**
 * Checks if a dictionary key matches any referenced key, accounting for plural suffixes (_one, _other, etc.).
 */
export function isKeyReferenced(key: string, referencedKeys: Set<string>): boolean {
  if (referencedKeys.has(key)) return true;

  // Plural suffix check: e.g. 'ITEM_one' or 'item_other' or 'itemOne'
  if (key.endsWith("_one")) {
    const base = key.slice(0, -4);
    if (referencedKeys.has(base)) return true;
  }
  if (key.endsWith("_other")) {
    const base = key.slice(0, -6);
    if (referencedKeys.has(base)) return true;
  }
  if (key.endsWith("_zero") || key.endsWith("_few") || key.endsWith("_many")) {
    const base = key.replace(/_(zero|few|many)$/, "");
    if (referencedKeys.has(base)) return true;
  }

  return false;
}

/**
 * Scans the codebase for translation key references and identifies unused/dead keys.
 */
export async function detectDeadKeys(params: {
  projectRoot: string;
  sourceFiles: string[];
  sourceTranslations: Map<string, Map<string, string>>; // ns -> (key -> value)
}): Promise<DeadKeyScanResult> {
  const { projectRoot, sourceFiles, sourceTranslations } = params;
  const allReferencedKeys = new Set<string>();

  // 1. Gather all referenced keys across all source files
  for (const relFile of sourceFiles) {
    const absFile = path.join(projectRoot, relFile);
    if (!(await fileExists(absFile))) continue;
    const content = await readTextFile(absFile);
    if (!content) continue;

    const fileKeys = extractReferencedKeysFromSource(content);
    for (const k of fileKeys) {
      allReferencedKeys.add(k);
    }
  }

  // 2. Cross-reference with dictionary keys
  const unusedKeys: UnusedKeyInfo[] = [];
  let totalKeysCount = 0;
  let usedKeysCount = 0;

  for (const [ns, keysMap] of sourceTranslations.entries()) {
    for (const key of keysMap.keys()) {
      totalKeysCount++;
      const fullNamespacedKey = `${ns}:${key}`;

      if (
        isKeyReferenced(key, allReferencedKeys) ||
        isKeyReferenced(fullNamespacedKey, allReferencedKeys)
      ) {
        usedKeysCount++;
      } else {
        unusedKeys.push({ namespace: ns, key });
      }
    }
  }

  return {
    unusedKeys,
    usedKeysCount,
    totalKeysCount,
  };
}

/**
 * Prunes unused keys from all locale files in the locale directory.
 */
export async function pruneUnusedKeys(params: {
  projectRoot: string;
  localeDirectory: string;
  unusedKeys: UnusedKeyInfo[];
}): Promise<number> {
  const { projectRoot, localeDirectory, unusedKeys } = params;
  if (unusedKeys.length === 0) return 0;

  const fullLocalePath = path.join(projectRoot, localeDirectory);
  const subdirs = await listDirectories(fullLocalePath);
  const allTargetFiles: string[] = [];

  if (subdirs.length > 0) {
    for (const sub of subdirs) {
      if (sub.startsWith(".") || sub === "node_modules") continue;
      const subPath = path.join(fullLocalePath, sub);
      const subFiles = await listFiles(subPath);
      for (const sf of subFiles) {
        allTargetFiles.push(path.join(sub, sf));
      }
    }
  }

  // Also include files directly in localeDirectory
  const directFiles = await listFiles(fullLocalePath);
  for (const df of directFiles) {
    allTargetFiles.push(df);
  }

  let prunedCount = 0;

  // Group unused keys by namespace
  const unusedByNamespace = new Map<string, Set<string>>();
  for (const u of unusedKeys) {
    const set = unusedByNamespace.get(u.namespace) || new Set<string>();
    set.add(u.key);
    unusedByNamespace.set(u.namespace, set);
  }

  // 1. Check directory layout: locales/<locale>/<ns>.json or locales/<locale>.json or locales/*.arb
  for (const f of allTargetFiles) {
    const absFilePath = path.join(fullLocalePath, f);

    if (isArbFile(f)) {
      const content = await readTextFile(absFilePath);
      if (!content) continue;
      const arb = parseArb(content);
      let modified = false;

      for (const u of unusedKeys) {
        if (arb.entries.has(u.key)) {
          arb.entries.delete(u.key);
          arb.keyMetadata.delete(u.key);
          modified = true;
          prunedCount++;
        }
      }

      if (modified) {
        await writeTextFile(absFilePath, serializeArb(arb));
      }
    } else if (f.endsWith(".json")) {
      const content = await readTextFile(absFilePath);
      if (!content) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        continue;
      }

      let modified = false;
      const nsFromFile = path.basename(f, ".json");
      const targetUnused = unusedByNamespace.get(nsFromFile) || new Set<string>();

      // Check flat or nested keys
      for (const key of targetUnused) {
        if (deleteNestedValue(parsed, key)) {
          modified = true;
          prunedCount++;
        }
      }

      // Also check all unused keys under namespace objects if multi-namespace single file
      for (const [ns, keys] of unusedByNamespace.entries()) {
        for (const key of keys) {
          const namespacedPath = `${ns}.${key}`;
          if (deleteNestedValue(parsed, namespacedPath)) {
            modified = true;
            prunedCount++;
          }
        }
      }

      if (modified) {
        await writeTextFile(absFilePath, JSON.stringify(parsed, null, 2) + "\n");
      }
    }
  }

  return prunedCount;
}
