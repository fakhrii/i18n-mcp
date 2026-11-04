import * as path from "node:path";
import * as fs from "node:fs/promises";
import fg from "fast-glob";
import {
  parseXCStrings,
  serializeXCStrings,
  setXCStringValue,
} from "./xcstrings-handler.js";
import {
  parseAppleStrings,
  serializeAppleStrings,
} from "./apple-strings-handler.js";
import {
  parseAndroidStrings,
  serializeAndroidStrings,
} from "./android-strings-handler.js";
import { fileExists, readTextFile, toPosixPath } from "../../utils/file-system.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";

export interface NativeCatalogDiscovery {
  hasXCStrings: boolean;
  xcstringsFiles: string[];
  hasAppleStrings: boolean;
  appleStringsFiles: string[];
  hasAndroidStrings: boolean;
  androidStringsFiles: string[];
}

/**
 * Discovers Apple (.xcstrings, .strings) and Android (strings.xml) native catalogs in a project.
 */
export async function discoverNativeMobileCatalogs(
  projectRoot: string
): Promise<NativeCatalogDiscovery> {
  const posixRoot = toPosixPath(path.resolve(projectRoot));

  const ignore = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/Pods/**",
    "**/.gradle/**",
  ];

  // 1. Search for .xcstrings
  const xcstrings = await fg("**/*.xcstrings", {
    cwd: posixRoot,
    ignore,
    absolute: true,
  });

  // 2. Search for Apple .strings (e.g. en.lproj/Localizable.strings)
  const appleStrings = await fg("**/*.lproj/*.strings", {
    cwd: posixRoot,
    ignore,
    absolute: true,
  });

  // 3. Search for Android strings.xml (e.g. res/values/strings.xml, res/values-fr/strings.xml)
  const androidStrings = await fg("**/res/values*/strings.xml", {
    cwd: posixRoot,
    ignore,
    absolute: true,
  });

  return {
    hasXCStrings: xcstrings.length > 0,
    xcstringsFiles: xcstrings.map((p) => toPosixPath(path.relative(posixRoot, p))),
    hasAppleStrings: appleStrings.length > 0,
    appleStringsFiles: appleStrings.map((p) => toPosixPath(path.relative(posixRoot, p))),
    hasAndroidStrings: androidStrings.length > 0,
    androidStringsFiles: androidStrings.map((p) => toPosixPath(path.relative(posixRoot, p))),
  };
}

export interface NativeTranslationUpdateResult {
  file: string;
  modified: boolean;
  diff?: string;
}

/**
 * Updates an Apple String Catalog (.xcstrings) with a translation for a given locale.
 */
export async function updateXCStringsTranslation(
  absFilePath: string,
  key: string,
  targetLocale: string,
  value: string,
  comment?: string,
  dryRun = false
): Promise<NativeTranslationUpdateResult> {
  const original = (await readTextFile(absFilePath)) || "{}";
  const catalog = parseXCStrings(original);

  setXCStringValue(catalog, key, targetLocale, value, comment);

  const updated = serializeXCStrings(catalog);
  const relPath = toPosixPath(path.basename(absFilePath));
  const diff = generateUnifiedDiff(relPath, original, updated);

  if (!dryRun && diff) {
    await fs.writeFile(absFilePath, updated, "utf8");
  }

  return {
    file: absPathToRel(absFilePath),
    modified: Boolean(diff),
    diff: diff || undefined,
  };
}

/**
 * Updates an Apple legacy .strings file (e.g. en.lproj/Localizable.strings) with a translation.
 */
export async function updateAppleStringsTranslation(
  absFilePath: string,
  key: string,
  value: string,
  comment?: string,
  dryRun = false
): Promise<NativeTranslationUpdateResult> {
  let original = "";
  if (await fileExists(absFilePath)) {
    original = (await readTextFile(absFilePath)) || "";
  }
  const entries = parseAppleStrings(original);
  const existingIdx = entries.findIndex((e) => e.key === key);
  if (existingIdx >= 0) {
    entries[existingIdx]!.value = value;
    if (comment) entries[existingIdx]!.comment = comment;
  } else {
    entries.push({ key, value, comment });
  }

  const updated = serializeAppleStrings(entries);
  const relPath = toPosixPath(path.basename(absFilePath));
  const diff = generateUnifiedDiff(relPath, original, updated);

  if (!dryRun && diff) {
    await fs.mkdir(path.dirname(absFilePath), { recursive: true });
    await fs.writeFile(absFilePath, updated, "utf8");
  }

  return {
    file: absPathToRel(absFilePath),
    modified: Boolean(diff),
    diff: diff || undefined,
  };
}

/**
 * Updates or creates an Android strings.xml translation for a given target locale.
 */
export async function updateAndroidTranslation(
  resDirAbs: string, // e.g. path to .../res
  name: string,
  targetLocale: string,
  value: string,
  comment?: string,
  dryRun = false
): Promise<NativeTranslationUpdateResult> {
  const valuesDir = path.join(resDirAbs, `values-${targetLocale}`);
  await fs.mkdir(valuesDir, { recursive: true });

  const targetXmlFile = path.join(valuesDir, "strings.xml");
  let original = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n</resources>\n";

  if (await fileExists(targetXmlFile)) {
    original = (await readTextFile(targetXmlFile)) || original;
  }

  const catalog = parseAndroidStrings(original);
  catalog.strings.set(name, {
    name,
    value,
    comment,
    translatable: true,
  });

  const updated = serializeAndroidStrings(catalog);
  const relFile = toPosixPath(path.join(`values-${targetLocale}`, "strings.xml"));
  const diff = generateUnifiedDiff(relFile, original, updated);

  if (!dryRun && diff) {
    await fs.writeFile(targetXmlFile, updated, "utf8");
  }

  return {
    file: relFile,
    modified: Boolean(diff),
    diff: diff || undefined,
  };
}

function absPathToRel(absPath: string): string {
  return toPosixPath(path.basename(absPath));
}
