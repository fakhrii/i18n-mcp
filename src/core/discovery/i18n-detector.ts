import * as path from "node:path";
import type {
  I18nDetection,
  I18nLibraryType,
  I18nStructureType,
  ConfigWarning,
} from "../../models/project.js";
import type { I18nMcpConfig } from "../../models/config.js";
import {
  dirExists,
  fileExists,
  listDirectories,
  listFiles,
  readJsonFile,
  readTextFile,
  findFilesByGlob,
  toPosixPath,
} from "../../utils/file-system.js";

const COMMON_LOCALE_DIRS = [
  "src/locales",
  "locales",
  "src/messages",
  "messages",
  "lib/l10n",
  "l10n",
  "src/assets/i18n",
  "assets/i18n",
  "public/i18n",
  "src/assets/locales",
  "assets/locales",
  "src/translations",
  "translations",
  "src/i18n/locales",
  "src/i18n/translations",
];

const COMMON_CONFIG_FILES = [
  "src/i18n/index.ts",
  "src/i18n/index.js",
  "src/i18n.ts",
  "src/i18n.js",
  "src/config/i18n.ts",
  "src/config/i18n.js",
  "src/services/i18n.ts",
  "src/services/i18n.js",
  "src/utils/i18n.ts",
  "src/utils/i18n.js",
  "src/app/i18n.config.ts",
  "src/app/i18n.config.js",
  "src/app/app.config.ts",
  "src/app/app.module.ts",
  "i18n.ts",
  "i18n.js",
  "l10n.yaml",
];

export interface I18nDiscoveryResult {
  i18n: I18nDetection;
  namespaces: string[];
  accessPatterns: string[];
  warnings: ConfigWarning[];
  structureType: I18nStructureType;
}

export interface CodeI18nConfig {
  library?: I18nLibraryType;
  sourceLocale?: string;
  allLocales?: string[];
  defaultNamespace?: string;
  namespaces?: string[];
  localeDirectory?: string;
}

function extractResourcesLocales(content: string): string[] {
  const match = content.match(/resources\s*:\s*\{/);
  if (!match || match.index === undefined) return [];
  const startIdx = match.index + match[0].length;
  let depth = 1;
  let endIdx = startIdx;
  while (depth > 0 && endIdx < content.length) {
    if (content[endIdx] === "{") depth++;
    else if (content[endIdx] === "}") depth--;
    endIdx++;
  }
  const resourcesBody = content.slice(startIdx, endIdx - 1);

  const keyMatches = Array.from(
    resourcesBody.matchAll(
      /(?:^|\n)\s*['"]?([a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?)['"]?\s*:\s*[{a-zA-Z0-9_]/g
    )
  );
  return keyMatches.map((m) => m[1]!).filter(Boolean);
}

/**
 * Extracts configuration options declared in project i18n code files
 * (e.g. fallbackLng, lng, supportedLngs, resources, defaultNS, ns, locale imports).
 */
export function parseCodeLevelI18nConfig(content: string): CodeI18nConfig {
  const result: CodeI18nConfig = {};

  // 1. Library detection from imports/usage
  if (content.includes("react-i18next") || content.includes("initReactI18next")) {
    result.library = "react-i18next";
  } else if (content.includes("i18next")) {
    result.library = "i18next";
  } else if (
    content.includes("@ngx-translate") ||
    content.includes("TranslateModule") ||
    content.includes("TranslateService")
  ) {
    result.library = "@ngx-translate/core";
  } else if (content.includes("@angular/localize") || content.includes("$localize")) {
    result.library = "@angular/localize";
  } else if (content.includes("@ngneat/transloco") || content.includes("TranslocoModule")) {
    result.library = "transloco";
  }

  // 2. fallbackLng: 'en' or fallbackLng: ['en', 'fr']
  const fallbackMatch = content.match(
    /fallbackLng\s*:\s*(?:['"]([a-zA-Z_-]+)['"]|\[\s*['"]([a-zA-Z_-]+)['"])/
  );
  if (fallbackMatch) {
    result.sourceLocale = fallbackMatch[1] || fallbackMatch[2];
  }

  // 3. lng: 'en'
  const lngMatch = content.match(/\blng\s*:\s*['"]([a-zA-Z_-]+)['"]/);
  if (lngMatch && !result.sourceLocale) {
    result.sourceLocale = lngMatch[1];
  }

  // 4. supportedLngs: ['en', 'fr', 'es'] or languages: ['en', 'fr']
  const supportedLngsMatch = content.match(
    /(?:supportedLngs|supportedLanguages|languages|locales)\s*:\s*\[([^\]]+)\]/
  );
  if (supportedLngsMatch && supportedLngsMatch[1]) {
    const lngs = supportedLngsMatch[1]
      .split(",")
      .map((s) => s.replace(/['"\s]/g, ""))
      .filter(Boolean);
    if (lngs.length > 0) {
      result.allLocales = lngs;
    }
  }

  // 5. resources: { en: ..., fr: ..., es: ... }
  const resourcesLocales = extractResourcesLocales(content);
  if (resourcesLocales.length > 0) {
    result.allLocales = Array.from(new Set([...(result.allLocales || []), ...resourcesLocales]));
  }

  // 6. defaultNS: 'common' or defaultNamespace: 'common'
  const defaultNsMatch = content.match(
    /(?:defaultNS|defaultNamespace)\s*:\s*['"]([^'"]+)['"]/
  );
  if (defaultNsMatch && defaultNsMatch[1]) {
    result.defaultNamespace = defaultNsMatch[1];
  }

  // 7. ns: ['common', 'auth']
  const nsMatch = content.match(/\bns\s*:\s*\[([^\]]+)\]/);
  if (nsMatch && nsMatch[1]) {
    result.namespaces = nsMatch[1]
      .split(",")
      .map((s) => s.replace(/['"\s]/g, ""))
      .filter(Boolean);
  }

  // 8. Infer localeDirectory from import statements
  const importLocaleMatch = content.match(
    /['"](?:\.\/|\.\.\/)?([a-zA-Z0-9_\-\/]*locales[a-zA-Z0-9_\-\/]*)\/[a-zA-Z_-]+\.json['"]/
  );
  if (importLocaleMatch && importLocaleMatch[1]) {
    result.localeDirectory = importLocaleMatch[1];
  }

  return result;
}

export async function detectI18n(
  projectRoot: string,
  allDependencies: Record<string, string>,
  userConfig?: I18nMcpConfig | null
): Promise<I18nDiscoveryResult> {
  const warnings: ConfigWarning[] = [];
  const accessPatterns: Set<string> = new Set();

  // 1. Detect Library
  let library: I18nLibraryType = "none";
  if (userConfig?.library) {
    library = userConfig.library;
  } else if ("react-i18next" in allDependencies) {
    library = "react-i18next";
  } else if ("i18next" in allDependencies) {
    library = "i18next";
  } else if ("flutter_localizations" in allDependencies) {
    library = "flutter_localizations";
  } else if ("@ngx-translate/core" in allDependencies || "ngx-translate" in allDependencies) {
    library = "@ngx-translate/core";
  } else if ("@angular/localize" in allDependencies) {
    library = "@angular/localize";
  } else if ("@ngneat/transloco" in allDependencies || "transloco" in allDependencies) {
    library = "transloco";
  } else if ("vue-i18n" in allDependencies) {
    library = "vue-i18n";
  } else if ("@nuxtjs/i18n" in allDependencies) {
    library = "@nuxtjs/i18n";
  }

  // 2. Detect Config File in project
  let configFile: string | undefined;
  for (const candidate of COMMON_CONFIG_FILES) {
    const fullPath = path.join(projectRoot, candidate);
    if (await fileExists(fullPath)) {
      configFile = toPosixPath(candidate);
      break;
    }
  }

  // 3. Parse Code-Level Config if found
  let codeConfig: CodeI18nConfig = {};
  if (configFile) {
    const configContent = await readTextFile(path.join(projectRoot, configFile));
    if (configContent) {
      codeConfig = parseCodeLevelI18nConfig(configContent);
      if (library === "none" && codeConfig.library) {
        library = codeConfig.library;
      }
    }
  }

  if (library === "none" && configFile) {
    library = "custom";
  }

  // 4. Detect Locale Directory
  let localeDirectory: string | null = null;
  if (userConfig?.localeDirectory) {
    const userPath = path.join(projectRoot, userConfig.localeDirectory);
    if (await dirExists(userPath)) {
      localeDirectory = toPosixPath(userConfig.localeDirectory);
    } else {
      warnings.push({
        code: "CONFIGURED_LOCALE_DIR_NOT_FOUND",
        message: `Configured locale directory '${userConfig.localeDirectory}' does not exist.`,
        severity: "warning",
      });
    }
  }

  if (!localeDirectory && codeConfig.localeDirectory) {
    const candidatePath = path.join(projectRoot, codeConfig.localeDirectory);
    if (await dirExists(candidatePath)) {
      localeDirectory = toPosixPath(codeConfig.localeDirectory);
    }
  }

  if (!localeDirectory) {
    for (const candidate of COMMON_LOCALE_DIRS) {
      const fullPath = path.join(projectRoot, candidate);
      if (await dirExists(fullPath)) {
        localeDirectory = toPosixPath(candidate);
        break;
      }
    }
  }

  // 5. Inspect Locales and Namespaces from Disk
  const detectedLocales: string[] = [];
  const namespacesSet: Set<string> = new Set();
  const localeNamespacesMap: Map<string, Set<string>> = new Map();

  let hasSubdirs = false;
  let hasMultipleJsonPerSubdir = false;
  let hasSingleTranslationJson = false;
  let hasSingleJsonFiles = false;
  let singleJsonHasNestedObjects = false;
  let hasArbFiles = false;

  if (localeDirectory) {
    const fullLocalePath = path.join(projectRoot, localeDirectory);
    const subdirs = await listDirectories(fullLocalePath);

    if (subdirs.length > 0) {
      hasSubdirs = true;
      // Structure: locales/<locale>/<namespace>.json
      for (const localeName of subdirs) {
        if (localeName.startsWith(".") || localeName === "node_modules") continue;
        detectedLocales.push(localeName);
        const nsSet = new Set<string>();

        const localeSubdirPath = path.join(fullLocalePath, localeName);
        const files = await listFiles(localeSubdirPath);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));

        if (jsonFiles.length > 1) {
          hasMultipleJsonPerSubdir = true;
        } else if (
          jsonFiles.length === 1 &&
          (jsonFiles[0] === "translation.json" || jsonFiles[0] === `${localeName}.json`)
        ) {
          hasSingleTranslationJson = true;
        }

        for (const f of jsonFiles) {
          const ns = path.basename(f, ".json");
          namespacesSet.add(ns);
          nsSet.add(ns);

          const jsonContent = await readJsonFile<Record<string, unknown>>(
            path.join(localeSubdirPath, f)
          );
          if (jsonContent === null) {
            warnings.push({
              code: "MALFORMED_JSON",
              message: `Failed to parse JSON file in ${toPosixPath(path.join(localeDirectory, localeName, f))}`,
              severity: "error",
              file: toPosixPath(path.join(localeDirectory, localeName, f)),
            });
          } else if (typeof jsonContent === "object" && jsonContent !== null) {
            for (const [, val] of Object.entries(jsonContent)) {
              if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                singleJsonHasNestedObjects = true;
              }
            }
          }
        }
        localeNamespacesMap.set(localeName, nsSet);
      }
    } else {
      // Check for single file per locale: locales/<locale>.json
      const files = await listFiles(fullLocalePath);
      for (const f of files) {
        if (f.endsWith(".arb")) {
          hasArbFiles = true;
          if (library === "none") {
            library = "flutter_localizations";
          }
          const rawName = path.basename(f, ".arb");
          const localeName = rawName.replace(/^(app_|intl_)/, "") || rawName;
          detectedLocales.push(localeName);
          namespacesSet.add(rawName);
        } else if (f.endsWith(".json")) {
          hasSingleJsonFiles = true;
          const localeName = path.basename(f, ".json");
          detectedLocales.push(localeName);
          const jsonContent = await readJsonFile<Record<string, unknown>>(
            path.join(fullLocalePath, f)
          );
          if (jsonContent === null) {
            warnings.push({
              code: "MALFORMED_JSON",
              message: `Failed to parse JSON file in ${toPosixPath(path.join(localeDirectory, f))}`,
              severity: "error",
              file: toPosixPath(path.join(localeDirectory, f)),
            });
          } else if (typeof jsonContent === "object" && jsonContent !== null) {
            for (const [key, val] of Object.entries(jsonContent)) {
              if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                singleJsonHasNestedObjects = true;
                namespacesSet.add(key);
              }
            }
          }
        }
      }
    }
  }

  // 6. Determine Source Locale (Priority: userConfig -> codeConfig -> detectedLocales -> default 'en')
  let sourceLocale = userConfig?.locales?.source || codeConfig.sourceLocale;
  if (!sourceLocale) {
    if (detectedLocales.includes("en")) {
      sourceLocale = "en";
    } else if (detectedLocales.includes("en-US")) {
      sourceLocale = "en-US";
    } else if (detectedLocales.length > 0) {
      sourceLocale = detectedLocales[0]!;
    } else if (codeConfig.allLocales && codeConfig.allLocales.length > 0) {
      sourceLocale = codeConfig.allLocales.includes("en") ? "en" : codeConfig.allLocales[0]!;
    } else {
      sourceLocale = "en";
    }
  }

  // 7. Determine Target Locales (Merge userConfig + codeConfig + disk locales)
  const targetLocalesSet = new Set<string>();

  if (userConfig?.locales?.targets) {
    for (const t of userConfig.locales.targets) {
      if (t !== sourceLocale) targetLocalesSet.add(t);
    }
  }

  if (codeConfig.allLocales) {
    for (const l of codeConfig.allLocales) {
      if (l !== sourceLocale) targetLocalesSet.add(l);
    }
  }

  for (const l of detectedLocales) {
    if (l !== sourceLocale) targetLocalesSet.add(l);
  }

  const targetLocales = Array.from(targetLocalesSet);

  // 8. Merge Namespaces from codeConfig and userConfig
  if (codeConfig.defaultNamespace) {
    namespacesSet.add(codeConfig.defaultNamespace);
  }
  if (codeConfig.namespaces) {
    for (const ns of codeConfig.namespaces) {
      namespacesSet.add(ns);
    }
  }
  if (userConfig?.namespaces) {
    for (const ns of Object.values(userConfig.namespaces)) {
      namespacesSet.add(ns);
    }
  }

  // 9. Check Namespace consistency across locales
  if (localeNamespacesMap.size > 1) {
    const sourceNamespaces = localeNamespacesMap.get(sourceLocale) || namespacesSet;
    for (const targetLocale of targetLocales) {
      const targetNsSet = localeNamespacesMap.get(targetLocale);
      if (targetNsSet) {
        for (const srcNs of sourceNamespaces) {
          if (!targetNsSet.has(srcNs)) {
            warnings.push({
              code: "MISSING_LOCALE_NAMESPACE",
              message: `Namespace '${srcNs}' exists in source locale '${sourceLocale}' but is missing in target locale '${targetLocale}'.`,
              severity: "warning",
            });
          }
        }
      }
    }
  }

  // 10. Detect Translation Access Patterns in source code
  const sourceFiles = await findFilesByGlob("{src,lib,app}/**/*.{ts,tsx,js,jsx,dart,html}", projectRoot, [
    "**/node_modules/**",
    "**/dist/**",
    "**/__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
  ]);

  const sampleFiles = sourceFiles.slice(0, 30);
  for (const relPath of sampleFiles) {
    const content = await readTextFile(path.join(projectRoot, relPath));
    if (!content) continue;

    if (content.includes("AppLocalizations.of") || /\bl10n\./.test(content)) {
      accessPatterns.add("AppLocalizations");
    }
    if (content.includes("useTranslation")) {
      accessPatterns.add("useTranslation");
      if (/useTranslation\(\s*['"\[]/.test(content)) {
        accessPatterns.add("useTranslation:ns");
      } else if (/useTranslation\(\s*\)/.test(content)) {
        accessPatterns.add("useTranslation:none");
      }
    }
    if (/\bt\s*\(/.test(content)) {
      accessPatterns.add("t");
      if (/\bt\(\s*['"][a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+['"]/.test(content)) {
        accessPatterns.add("t:colon");
      }
      if (/\bt\(\s*['"][a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+['"]/.test(content)) {
        accessPatterns.add("t:dot");
      }
    }
    if (/i18n\.t\s*\(/.test(content)) {
      accessPatterns.add("i18n.t");
    }
    if (content.includes("<Trans") || content.includes("</Trans>")) {
      accessPatterns.add("Trans");
    }
    if (content.includes("| translate") || content.includes("[translate]") || content.includes("translate.instant")) {
      accessPatterns.add("translate:pipe");
    }
    if (content.includes("$localize")) {
      accessPatterns.add("$localize");
    }
    if (content.includes("| transloco")) {
      accessPatterns.add("transloco:pipe");
    }
  }

  // 11. Determine Structure Type: "namespaces" | "nested" | "flat"
  let structureType: I18nStructureType;

  if (userConfig?.structure) {
    structureType = userConfig.structure;
  } else if (hasArbFiles) {
    structureType = "flat";
  } else if (hasMultipleJsonPerSubdir) {
    structureType = "namespaces";
  } else if (hasSingleJsonFiles || hasSingleTranslationJson) {
    if (accessPatterns.has("t:colon") || accessPatterns.has("useTranslation:ns")) {
      structureType = "namespaces";
    } else if (singleJsonHasNestedObjects || accessPatterns.has("t:dot")) {
      structureType = "nested";
    } else {
      structureType = "flat";
    }
  } else if (hasSubdirs) {
    if (codeConfig.namespaces && codeConfig.namespaces.length > 1) {
      structureType = "namespaces";
    } else if (accessPatterns.has("t:colon") || accessPatterns.has("useTranslation:ns")) {
      structureType = "namespaces";
    } else if (singleJsonHasNestedObjects) {
      structureType = "nested";
    } else {
      structureType = "namespaces";
    }
  } else {
    // Greenfield or no locale directory yet
    if (accessPatterns.has("t:dot") && !accessPatterns.has("t:colon")) {
      structureType = "nested";
    } else {
      structureType = "namespaces";
    }
  }

  const detected =
    library !== "none" || localeDirectory !== null || configFile !== undefined;
  const needsSetup = !detected;

  if (detected && !localeDirectory) {
    warnings.push({
      code: "NO_LOCALE_DIRECTORY_DETECTED",
      message: "i18n library or configuration detected, but no locale directory was found.",
      severity: "warning",
    });
  }

  return {
    i18n: {
      library,
      detected,
      localeDirectory,
      sourceLocale,
      targetLocales,
      ...(configFile ? { configFile } : {}),
      needsSetup,
      structureType,
    },
    namespaces: Array.from(namespacesSet).sort(),
    accessPatterns: Array.from(accessPatterns).sort(),
    warnings,
    structureType,
  };
}
