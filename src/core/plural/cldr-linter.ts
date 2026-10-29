import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  CldrPluralCategory,
  PluralAuditOptions,
  PluralAuditResult,
  PluralIssue,
} from "../../models/plural.js";
import {
  ALL_CLDR_CATEGORIES,
  getRequiredPluralCategories,
} from "./cldr-rules.js";
import {
  injectMissingIcuBranches,
  parseIcuClauses,
} from "./icu-parser.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import {
  dirExists,
  listFiles,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import {
  parseArb,
  serializeArb,
  type ArbFile,
} from "../locale/arb-handler.js";
import {
  isXCStringsFile,
  parseXCStrings,
  serializeXCStrings,
  setXCStringPlural,
  type XCStringCatalog,
} from "../locale/xcstrings-handler.js";
import {
  isAndroidStringsFile,
  parseAndroidStrings,
  serializeAndroidStrings,
  type AndroidCatalog,
} from "../locale/android-strings-handler.js";
import { discoverNativeMobileCatalogs } from "../locale/native-mobile.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

/**
 * Extracts locale code from an Android resource path (e.g. values-ar/strings.xml -> 'ar').
 */
function extractAndroidLocale(filePath: string, defaultLocale = "en"): string {
  const norm = filePath.replace(/\\/g, "/");
  const m = norm.match(/(?:^|\/)values-([a-zA-Z]{2,3})(?:-r([a-zA-Z]{2}))?(?:\/|$)/);
  if (m) {
    const lang = m[1]!;
    const region = m[2];
    return region ? `${lang}-${region}` : lang;
  }
  const bMatch = norm.match(/(?:^|\/)values-b\+([a-zA-Z0-9+]+)(?:\/|$)/);
  if (bMatch && bMatch[1]) {
    return bMatch[1].replace(/\+/g, "-");
  }
  return defaultLocale;
}

/**
 * Detects indentation style used in a JSON string.
 */
function detectIndentation(jsonString: string): string {
  const match = jsonString.match(/^[ \t]+(?=")/m);
  return match ? match[0] : "  ";
}

/**
 * Extracts all string key-value pairs recursively from a nested JSON object.
 */
function extractAllStringEntries(
  obj: unknown,
  prefix = ""
): Array<{ keyPath: string[]; fullKey: string; value: string }> {
  const entries: Array<{ keyPath: string[]; fullKey: string; value: string }> = [];

  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === "string") {
        entries.push({ keyPath: [key], fullKey, value: val });
      } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        const nested = extractAllStringEntries(val, fullKey);
        for (const n of nested) {
          entries.push({
            keyPath: [key, ...n.keyPath],
            fullKey: n.fullKey,
            value: n.value,
          });
        }
      }
    }
  }

  return entries;
}

/**
 * Sets a value in a nested object along a key path.
 */
function setNestedVal(obj: Record<string, unknown>, keyPath: string[], value: unknown): void {
  let curr = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const k = keyPath[i]!;
    if (typeof curr[k] !== "object" || curr[k] === null || Array.isArray(curr[k])) {
      curr[k] = {};
    }
    curr = curr[k] as Record<string, unknown>;
  }
  const lastKey = keyPath[keyPath.length - 1]!;
  curr[lastKey] = value;
}

/**
 * Audits project catalogs for Unicode CLDR plural compliance and ICU MessageFormat integrity.
 */
export async function auditPlurals(
  options: PluralAuditOptions = {}
): Promise<PluralAuditResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const fix = options.fix ?? false;
  const dryRun = options.dryRun ?? true;

  logger.info(
    `Auditing CLDR plurals in ${projectRoot} (fix=${fix}, dryRun=${dryRun})`
  );

  let analysis;
  try {
    analysis = await analyzeProject(projectRoot);
  } catch (err: unknown) {
    return {
      totalCatalogs: 0,
      totalPluralsAudited: 0,
      totalIssues: 0,
      missingCategoriesCount: 0,
      missingOtherFallbackCount: 0,
      invalidCategoriesCount: 0,
      issues: [],
      filesAffected: [],
    };
  }

  const targetLocalesFilter = options.locales && options.locales.length > 0
    ? new Set(options.locales.map((l) => l.toLowerCase()))
    : null;

  const targetNamespacesFilter = options.namespaces && options.namespaces.length > 0
    ? new Set(options.namespaces.map((n) => n.toLowerCase()))
    : null;

  interface CatalogTarget {
    relPath: string;
    absPath: string;
    locale: string;
    namespace?: string;
    format: "arb" | "json" | "xcstrings" | "android";
  }

  const targets: CatalogTarget[] = [];
  const registeredPaths = new Set<string>();

  const localeDir = analysis.i18n.localeDirectory;
  if (localeDir) {
    const fullLocaleDir = path.join(projectRoot, localeDir);
    if (await dirExists(fullLocaleDir)) {
      const allFiles = await listFiles(fullLocaleDir);
      for (const f of allFiles) {
        const ext = path.extname(f).toLowerCase();
        const isArb = ext === ".arb";
        const isJson = ext === ".json";
        const isXCStrings = isXCStringsFile(f);
        const isAndroid = isAndroidStringsFile(f);
        if (!isArb && !isJson && !isXCStrings && !isAndroid) continue;

        const relPath = toPosixPath(path.join(localeDir, f));
        const absPath = path.join(projectRoot, relPath);

        if (isXCStrings) {
          registeredPaths.add(relPath);
          targets.push({ relPath, absPath, locale: "*", format: "xcstrings" });
        } else if (isAndroid) {
          const locale = extractAndroidLocale(relPath, analysis.i18n.sourceLocale || "en");
          if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
            continue;
          }
          registeredPaths.add(relPath);
          targets.push({ relPath, absPath, locale, format: "android" });
        } else if (isArb) {
          let locale = "en";
          const m = f.match(/^(?:app_|intl_)?([a-zA-Z0-9_-]+)\.arb$/);
          if (m && m[1]) locale = m[1];

          if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
            continue;
          }
          registeredPaths.add(relPath);
          targets.push({ relPath, absPath, locale, format: "arb" });
        } else {
          // JSON
          const parts = toPosixPath(f).split("/");
          if (parts.length === 1) {
            // locales/en.json
            const locale = path.basename(f, ".json");
            if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
              continue;
            }
            registeredPaths.add(relPath);
            targets.push({ relPath, absPath, locale, format: "json" });
          } else if (parts.length === 2) {
            // locales/en/common.json
            const locale = parts[0]!;
            const ns = path.basename(parts[1]!, ".json");
            if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
              continue;
            }
            if (targetNamespacesFilter && !targetNamespacesFilter.has(ns.toLowerCase())) {
              continue;
            }
            registeredPaths.add(relPath);
            targets.push({ relPath, absPath, locale, namespace: ns, format: "json" });
          }
        }
      }
    }
  }

  // Also discover native mobile catalogs across project
  try {
    const nativeDiscovery = await discoverNativeMobileCatalogs(projectRoot);
    for (const xcf of nativeDiscovery.xcstringsFiles) {
      if (!registeredPaths.has(xcf)) {
        registeredPaths.add(xcf);
        targets.push({
          relPath: xcf,
          absPath: path.join(projectRoot, xcf),
          locale: "*",
          format: "xcstrings",
        });
      }
    }
    for (const af of nativeDiscovery.androidStringsFiles) {
      if (!registeredPaths.has(af)) {
        const locale = extractAndroidLocale(af, analysis.i18n.sourceLocale || "en");
        if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
          continue;
        }
        registeredPaths.add(af);
        targets.push({
          relPath: af,
          absPath: path.join(projectRoot, af),
          locale,
          format: "android",
        });
      }
    }
  } catch {
    // ignore discovery errors
  }

  if (targets.length === 0) {
    return {
      totalCatalogs: 0,
      totalPluralsAudited: 0,
      totalIssues: 0,
      missingCategoriesCount: 0,
      missingOtherFallbackCount: 0,
      invalidCategoriesCount: 0,
      issues: [],
      filesAffected: [],
    };
  }

  const issues: PluralIssue[] = [];
  let totalPluralsAudited = 0;
  let missingCategoriesCount = 0;
  let missingOtherFallbackCount = 0;
  let invalidCategoriesCount = 0;
  let fixesApplied = 0;
  const filesModified: string[] = [];
  const diffParts: string[] = [];

  for (const target of targets) {
    const content = (await readTextFile(target.absPath)) || "";
    let fileHasFixes = false;

    if (target.format === "arb") {
      let arb: ArbFile;
      try {
        arb = parseArb(content);
      } catch {
        continue;
      }

      const effectiveLocale = arb.locale || target.locale;
      const requiredCategories = getRequiredPluralCategories(effectiveLocale);

      for (const [key, textVal] of arb.entries.entries()) {
        const clauses = parseIcuClauses(textVal);
        if (clauses.length === 0) continue;

        totalPluralsAudited += clauses.length;
        let updatedText = textVal;

        for (const clause of clauses) {
          if (clause.type === "plural") {
            const actualSelectors = clause.branches.map((b) => b.selector);
            const actualCategories = actualSelectors.filter((s) => !s.startsWith("="));
            const hasOther = actualSelectors.includes("other");

            // 1. Check for mandatory 'other' fallback
            if (!hasOther) {
              missingOtherFallbackCount++;
              const issue: PluralIssue = {
                id: `${target.relPath}:${key}:missing-other`,
                file: target.relPath,
                key,
                locale: effectiveLocale,
                format: "ICU_PLURAL",
                issueType: "MISSING_OTHER_FALLBACK",
                severity: "error",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: ["other"],
                message: `Missing mandatory 'other' fallback branch in ICU plural for key '${key}'. ICU runtime formatters will crash on unmatched numbers without 'other'.`,
                autoFixable: true,
              };
              issues.push(issue);
            }

            // 2. Check for missing required CLDR categories
            const missingRequired = requiredCategories.filter((cat) => {
              if (cat === "zero" && actualSelectors.includes("=0")) return false;
              if (cat === "one" && actualSelectors.includes("=1")) return false;
              return !actualSelectors.includes(cat);
            });

            if (missingRequired.length > 0) {
              missingCategoriesCount += missingRequired.length;
              const issue: PluralIssue = {
                id: `${target.relPath}:${key}:missing-cldr`,
                file: target.relPath,
                key,
                locale: effectiveLocale,
                format: "ICU_PLURAL",
                issueType: "MISSING_REQUIRED_PLURAL",
                severity: "warning",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: missingRequired,
                message: `Locale '${effectiveLocale}' requires CLDR plural categories [${requiredCategories.join(", ")}], but is missing [${missingRequired.join(", ")}].`,
                autoFixable: true,
              };
              issues.push(issue);

              if (fix) {
                updatedText = injectMissingIcuBranches(updatedText, clause, missingRequired);
                arb.entries.set(key, updatedText);
                fileHasFixes = true;
                fixesApplied++;
              }
            }

            // 3. Check for invalid or unnecessary categories
            const invalidSelectors = actualCategories.filter(
              (cat) => !ALL_CLDR_CATEGORIES.includes(cat as CldrPluralCategory)
            );
            if (invalidSelectors.length > 0) {
              invalidCategoriesCount += invalidSelectors.length;
              issues.push({
                id: `${target.relPath}:${key}:invalid-selector`,
                file: target.relPath,
                key,
                locale: effectiveLocale,
                format: "ICU_PLURAL",
                issueType: "INVALID_PLURAL_CATEGORY",
                severity: "warning",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: [],
                message: `Invalid plural category selectors [${invalidSelectors.join(", ")}] found in key '${key}'.`,
                autoFixable: false,
              });
            }
          } else if (clause.type === "select") {
            const actualSelectors = clause.branches.map((b) => b.selector);
            if (!actualSelectors.includes("other")) {
              missingOtherFallbackCount++;
              issues.push({
                id: `${target.relPath}:${key}:missing-select-other`,
                file: target.relPath,
                key,
                locale: effectiveLocale,
                format: "ICU_SELECT",
                issueType: "MISSING_OTHER_FALLBACK",
                severity: "error",
                variableName: clause.variable,
                expectedCategories: ["other"],
                actualCategories: actualSelectors,
                missingCategories: ["other"],
                message: `Missing mandatory 'other' fallback branch in ICU select for key '${key}'.`,
                autoFixable: false,
              });
            }
          }
        }
      }

      if (fileHasFixes) {
        const indent = detectIndentation(content);
        const serialized = serializeArb(arb, indent);
        const diff = generateUnifiedDiff(target.relPath, content, serialized);
        if (diff) diffParts.push(diff);
        filesModified.push(target.relPath);

        if (!dryRun) {
          await fs.writeFile(target.absPath, serialized, "utf8");
        }
      }
    } else if (target.format === "xcstrings") {
      let catalog: XCStringCatalog;
      try {
        catalog = parseXCStrings(content);
      } catch {
        continue;
      }

      for (const [key, entry] of Object.entries(catalog.strings || {})) {
        if (!entry.localizations) continue;

        for (const [locale, loc] of Object.entries(entry.localizations)) {
          if (targetLocalesFilter && !targetLocalesFilter.has(locale.toLowerCase())) {
            continue;
          }
          if (!loc.variations?.plural) continue;

          totalPluralsAudited++;
          const actualCategories = Object.keys(loc.variations.plural);
          const requiredCategories = getRequiredPluralCategories(locale);

          // 1. Mandatory 'other' fallback
          if (!actualCategories.includes("other")) {
            missingOtherFallbackCount++;
            issues.push({
              id: `${target.relPath}:${key}:${locale}:missing-other`,
              file: target.relPath,
              key,
              locale,
              format: "XCSTRINGS_PLURAL",
              issueType: "MISSING_OTHER_FALLBACK",
              severity: "error",
              expectedCategories: requiredCategories,
              actualCategories,
              missingCategories: ["other"],
              message: `Missing mandatory 'other' fallback variation in Apple String Catalog for key '${key}' in locale '${locale}'.`,
              autoFixable: true,
            });
          }

          // 2. Missing required CLDR categories
          const missingRequired = requiredCategories.filter((cat) => !actualCategories.includes(cat));
          if (missingRequired.length > 0) {
            missingCategoriesCount += missingRequired.length;
            issues.push({
              id: `${target.relPath}:${key}:${locale}:missing-cldr`,
              file: target.relPath,
              key,
              locale,
              format: "XCSTRINGS_PLURAL",
              issueType: "MISSING_REQUIRED_PLURAL",
              severity: "warning",
              expectedCategories: requiredCategories,
              actualCategories,
              missingCategories: missingRequired,
              message: `Locale '${locale}' requires CLDR plural variations [${requiredCategories.join(", ")}], but Apple String Catalog key '${key}' is missing [${missingRequired.join(", ")}].`,
              autoFixable: true,
            });

            if (fix) {
              const templateVal =
                loc.variations.plural["other"]?.stringUnit?.value ||
                Object.values(loc.variations.plural)[0]?.stringUnit?.value ||
                key;
              for (const missingCat of missingRequired) {
                setXCStringPlural(catalog, key, locale, missingCat, templateVal);
                fileHasFixes = true;
                fixesApplied++;
              }
            }
          }

          // 3. Invalid categories
          const invalidCategories = actualCategories.filter(
            (cat) => !ALL_CLDR_CATEGORIES.includes(cat as CldrPluralCategory)
          );
          if (invalidCategories.length > 0) {
            invalidCategoriesCount += invalidCategories.length;
            issues.push({
              id: `${target.relPath}:${key}:${locale}:invalid-category`,
              file: target.relPath,
              key,
              locale,
              format: "XCSTRINGS_PLURAL",
              issueType: "INVALID_PLURAL_CATEGORY",
              severity: "warning",
              expectedCategories: requiredCategories,
              actualCategories,
              missingCategories: [],
              message: `Invalid plural category selectors [${invalidCategories.join(", ")}] found in Apple String Catalog key '${key}' for locale '${locale}'.`,
              autoFixable: false,
            });
          }
        }
      }

      if (fileHasFixes) {
        const indent = detectIndentation(content);
        const serialized = serializeXCStrings(catalog, indent);
        const diff = generateUnifiedDiff(target.relPath, content, serialized);
        if (diff) diffParts.push(diff);
        filesModified.push(target.relPath);

        if (!dryRun) {
          await fs.writeFile(target.absPath, serialized, "utf8");
        }
      }
    } else if (target.format === "android") {
      let androidCatalog: AndroidCatalog;
      try {
        androidCatalog = parseAndroidStrings(content);
      } catch {
        continue;
      }

      const requiredCategories = getRequiredPluralCategories(target.locale);

      for (const [name, pluralEntry] of androidCatalog.plurals.entries()) {
        totalPluralsAudited++;
        const actualCategories = Object.keys(pluralEntry.items);

        // 1. Mandatory 'other' fallback
        if (!actualCategories.includes("other")) {
          missingOtherFallbackCount++;
          issues.push({
            id: `${target.relPath}:${name}:missing-other`,
            file: target.relPath,
            key: name,
            locale: target.locale,
            format: "ANDROID_PLURALS",
            issueType: "MISSING_OTHER_FALLBACK",
            severity: "error",
            expectedCategories: requiredCategories,
            actualCategories,
            missingCategories: ["other"],
            message: `Missing mandatory 'other' quantity in Android <plurals name="${name}"> for locale '${target.locale}'. Android runtime will throw Resources$NotFoundException without 'other'.`,
            autoFixable: true,
          });
        }

        // 2. Missing required CLDR categories
        const missingRequired = requiredCategories.filter((cat) => !actualCategories.includes(cat));
        if (missingRequired.length > 0) {
          missingCategoriesCount += missingRequired.length;
          issues.push({
            id: `${target.relPath}:${name}:missing-cldr`,
            file: target.relPath,
            key: name,
            locale: target.locale,
            format: "ANDROID_PLURALS",
            issueType: "MISSING_REQUIRED_PLURAL",
            severity: "warning",
            expectedCategories: requiredCategories,
            actualCategories,
            missingCategories: missingRequired,
            message: `Locale '${target.locale}' requires CLDR plural quantities [${requiredCategories.join(", ")}], but Android <plurals name="${name}"> is missing [${missingRequired.join(", ")}].`,
            autoFixable: true,
          });

          if (fix) {
            const templateVal =
              pluralEntry.items["other"] ||
              Object.values(pluralEntry.items)[0] ||
              `%d ${name}`;
            for (const missingCat of missingRequired) {
              pluralEntry.items[missingCat] = templateVal;
              fileHasFixes = true;
              fixesApplied++;
            }
          }
        }

        // 3. Invalid categories
        const invalidCategories = actualCategories.filter(
          (cat) => !ALL_CLDR_CATEGORIES.includes(cat as CldrPluralCategory)
        );
        if (invalidCategories.length > 0) {
          invalidCategoriesCount += invalidCategories.length;
          issues.push({
            id: `${target.relPath}:${name}:invalid-quantity`,
            file: target.relPath,
            key: name,
            locale: target.locale,
            format: "ANDROID_PLURALS",
            issueType: "INVALID_PLURAL_CATEGORY",
            severity: "warning",
            expectedCategories: requiredCategories,
            actualCategories,
            missingCategories: [],
            message: `Invalid plural quantity [${invalidCategories.join(", ")}] found in Android <plurals name="${name}">.`,
            autoFixable: false,
          });
        }
      }

      if (fileHasFixes) {
        const serialized = serializeAndroidStrings(androidCatalog);
        const diff = generateUnifiedDiff(target.relPath, content, serialized);
        if (diff) diffParts.push(diff);
        filesModified.push(target.relPath);

        if (!dryRun) {
          await fs.writeFile(target.absPath, serialized, "utf8");
        }
      }
    } else {
      // JSON Catalog
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        continue;
      }

      const requiredCategories = getRequiredPluralCategories(target.locale);
      const entries = extractAllStringEntries(parsed);

      // A. Check ICU plurals in JSON strings
      for (const entry of entries) {
        const clauses = parseIcuClauses(entry.value);
        if (clauses.length === 0) continue;

        totalPluralsAudited += clauses.length;
        let updatedText = entry.value;

        for (const clause of clauses) {
          if (clause.type === "plural") {
            const actualSelectors = clause.branches.map((b) => b.selector);
            const actualCategories = actualSelectors.filter((s) => !s.startsWith("="));
            const hasOther = actualSelectors.includes("other");

            if (!hasOther) {
              missingOtherFallbackCount++;
              issues.push({
                id: `${target.relPath}:${entry.fullKey}:missing-other`,
                file: target.relPath,
                key: entry.fullKey,
                locale: target.locale,
                format: "ICU_PLURAL",
                issueType: "MISSING_OTHER_FALLBACK",
                severity: "error",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: ["other"],
                message: `Missing mandatory 'other' fallback branch in ICU plural for key '${entry.fullKey}'.`,
                autoFixable: true,
              });
            }

            const missingRequired = requiredCategories.filter((cat) => {
              if (cat === "zero" && actualSelectors.includes("=0")) return false;
              if (cat === "one" && actualSelectors.includes("=1")) return false;
              return !actualSelectors.includes(cat);
            });

            if (missingRequired.length > 0) {
              missingCategoriesCount += missingRequired.length;
              issues.push({
                id: `${target.relPath}:${entry.fullKey}:missing-cldr`,
                file: target.relPath,
                key: entry.fullKey,
                locale: target.locale,
                format: "ICU_PLURAL",
                issueType: "MISSING_REQUIRED_PLURAL",
                severity: "warning",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: missingRequired,
                message: `Locale '${target.locale}' requires CLDR plural categories [${requiredCategories.join(", ")}], but is missing [${missingRequired.join(", ")}].`,
                autoFixable: true,
              });

              if (fix) {
                updatedText = injectMissingIcuBranches(updatedText, clause, missingRequired);
                setNestedVal(parsed, entry.keyPath, updatedText);
                fileHasFixes = true;
                fixesApplied++;
              }
            }

            const invalidSelectors = actualCategories.filter(
              (cat) => !ALL_CLDR_CATEGORIES.includes(cat as CldrPluralCategory)
            );
            if (invalidSelectors.length > 0) {
              invalidCategoriesCount += invalidSelectors.length;
              issues.push({
                id: `${target.relPath}:${entry.fullKey}:invalid-selector`,
                file: target.relPath,
                key: entry.fullKey,
                locale: target.locale,
                format: "ICU_PLURAL",
                issueType: "INVALID_PLURAL_CATEGORY",
                severity: "warning",
                variableName: clause.variable,
                expectedCategories: requiredCategories,
                actualCategories: actualSelectors,
                missingCategories: [],
                message: `Invalid plural category selectors [${invalidSelectors.join(", ")}] found in key '${entry.fullKey}'.`,
                autoFixable: false,
              });
            }
          } else if (clause.type === "select") {
            const actualSelectors = clause.branches.map((b) => b.selector);
            if (!actualSelectors.includes("other")) {
              missingOtherFallbackCount++;
              issues.push({
                id: `${target.relPath}:${entry.fullKey}:missing-select-other`,
                file: target.relPath,
                key: entry.fullKey,
                locale: target.locale,
                format: "ICU_SELECT",
                issueType: "MISSING_OTHER_FALLBACK",
                severity: "error",
                variableName: clause.variable,
                expectedCategories: ["other"],
                actualCategories: actualSelectors,
                missingCategories: ["other"],
                message: `Missing mandatory 'other' fallback branch in ICU select for key '${entry.fullKey}'.`,
                autoFixable: false,
              });
            }
          }
        }
      }

      // B. Check i18next plural keys (key_one, key_few, key_many, key_other)
      const i18nextSuffixRegex = /^(.*)_(zero|one|two|few|many|other)$/;
      const groups = new Map<string, Map<string, { entry: typeof entries[0] }>>();

      for (const entry of entries) {
        const lastPart = entry.keyPath[entry.keyPath.length - 1]!;
        const m = lastPart.match(i18nextSuffixRegex);
        if (m && m[1] && m[2]) {
          const baseKey = m[1];
          const suffix = m[2];
          const parentPathStr = entry.keyPath.slice(0, -1).join(".");
          const groupIdentifier = parentPathStr ? `${parentPathStr}.${baseKey}` : baseKey;

          let groupMap = groups.get(groupIdentifier);
          if (!groupMap) {
            groupMap = new Map();
            groups.set(groupIdentifier, groupMap);
          }
          groupMap.set(suffix, { entry });
        }
      }

      for (const [baseKey, suffixMap] of groups.entries()) {
        totalPluralsAudited++;
        const actualSuffixes = Array.from(suffixMap.keys());
        const missingRequired = requiredCategories.filter((cat) => !suffixMap.has(cat));

        if (missingRequired.length > 0) {
          missingCategoriesCount += missingRequired.length;
          issues.push({
            id: `${target.relPath}:${baseKey}:missing-i18next-suffix`,
            file: target.relPath,
            key: baseKey,
            locale: target.locale,
            format: "I18NEXT_SUFFIX",
            issueType: "MISSING_REQUIRED_PLURAL",
            severity: "warning",
            expectedCategories: requiredCategories,
            actualCategories: actualSuffixes,
            missingCategories: missingRequired,
            message: `i18next plural group '${baseKey}' in '${target.locale}' is missing required suffixes [${missingRequired.map((s) => `${baseKey}_${s}`).join(", ")}].`,
            autoFixable: true,
          });

          if (fix) {
            // Template from 'other' or last available suffix
            const templateSuffix = suffixMap.has("other")
              ? suffixMap.get("other")!
              : Array.from(suffixMap.values())[0]!;
            const parentKeyPath = templateSuffix.entry.keyPath.slice(0, -1);
            const templateBaseName = templateSuffix.entry.keyPath[templateSuffix.entry.keyPath.length - 1]!.replace(
              /_(zero|one|two|few|many|other)$/,
              ""
            );

            for (const missingCat of missingRequired) {
              const newKeyPath = [...parentKeyPath, `${templateBaseName}_${missingCat}`];
              setNestedVal(parsed, newKeyPath, templateSuffix.entry.value);
              fileHasFixes = true;
              fixesApplied++;
            }
          }
        }
      }

      if (fileHasFixes) {
        const indent = detectIndentation(content);
        const serialized = JSON.stringify(parsed, null, indent) + "\n";
        const diff = generateUnifiedDiff(target.relPath, content, serialized);
        if (diff) diffParts.push(diff);
        filesModified.push(target.relPath);

        if (!dryRun) {
          await fs.writeFile(target.absPath, serialized, "utf8");
        }
      }
    }
  }

  const filesAffected = Array.from(new Set(issues.map((i) => i.file)));

  return {
    totalCatalogs: targets.length,
    totalPluralsAudited,
    totalIssues: issues.length,
    missingCategoriesCount,
    missingOtherFallbackCount,
    invalidCategoriesCount,
    issues,
    filesAffected,
    fixesApplied: fix ? fixesApplied : undefined,
    filesModified: fix && filesModified.length > 0 ? Array.from(new Set(filesModified)) : undefined,
    diff: diffParts.length > 0 ? diffParts.join("\n\n") : undefined,
  };
}
