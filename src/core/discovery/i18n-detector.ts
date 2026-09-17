import * as path from "node:path";
import type {
  I18nDetection,
  I18nLibraryType,
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
  "i18n.ts",
  "i18n.js",
];

export interface I18nDiscoveryResult {
  i18n: I18nDetection;
  namespaces: string[];
  accessPatterns: string[];
  warnings: ConfigWarning[];
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
  }

  // 2. Detect Config File
  let configFile: string | undefined;
  for (const candidate of COMMON_CONFIG_FILES) {
    const fullPath = path.join(projectRoot, candidate);
    if (await fileExists(fullPath)) {
      configFile = toPosixPath(candidate);
      break;
    }
  }

  // If library not yet detected but config file or i18n imports exist, detect custom or i18next
  if (library === "none" && configFile) {
    const configContent = await readTextFile(path.join(projectRoot, configFile));
    if (configContent) {
      if (configContent.includes("react-i18next")) {
        library = "react-i18next";
      } else if (configContent.includes("i18next")) {
        library = "i18next";
      } else {
        library = "custom";
      }
    }
  }

  // 3. Detect Locale Directory
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

  if (!localeDirectory) {
    for (const candidate of COMMON_LOCALE_DIRS) {
      const fullPath = path.join(projectRoot, candidate);
      if (await dirExists(fullPath)) {
        localeDirectory = toPosixPath(candidate);
        break;
      }
    }
  }

  // 4. Inspect Locales and Namespaces
  const detectedLocales: string[] = [];
  const namespacesSet: Set<string> = new Set();
  const localeNamespacesMap: Map<string, Set<string>> = new Map();

  if (localeDirectory) {
    const fullLocalePath = path.join(projectRoot, localeDirectory);
    const subdirs = await listDirectories(fullLocalePath);

    if (subdirs.length > 0) {
      // Structure: locales/<locale>/<namespace>.json
      for (const localeName of subdirs) {
        // Skip non-locale folders
        if (localeName.startsWith(".") || localeName === "node_modules") continue;
        detectedLocales.push(localeName);
        const nsSet = new Set<string>();

        const localeSubdirPath = path.join(fullLocalePath, localeName);
        const files = await listFiles(localeSubdirPath);
        for (const f of files) {
          if (f.endsWith(".json")) {
            const ns = path.basename(f, ".json");
            namespacesSet.add(ns);
            nsSet.add(ns);

            // Validate json syntax
            const jsonContent = await readJsonFile(path.join(localeSubdirPath, f));
            if (jsonContent === null) {
              warnings.push({
                code: "MALFORMED_JSON",
                message: `Failed to parse JSON file in ${toPosixPath(path.join(localeDirectory, localeName, f))}`,
                severity: "error",
                file: toPosixPath(path.join(localeDirectory, localeName, f)),
              });
            }
          }
        }
        localeNamespacesMap.set(localeName, nsSet);
      }
    } else {
      // Check for single file per locale: locales/<locale>.json
      const files = await listFiles(fullLocalePath);
      for (const f of files) {
        if (f.endsWith(".json")) {
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
            // If top-level values are objects, treat keys as namespaces
            for (const [key, val] of Object.entries(jsonContent)) {
              if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                namespacesSet.add(key);
              }
            }
          }
        }
      }
    }
  }

  // 5. Determine Source Locale and Target Locales
  let sourceLocale = userConfig?.locales?.source || "en";
  let targetLocales: string[] = userConfig?.locales?.targets || [];

  if (!userConfig?.locales?.source) {
    if (detectedLocales.includes("en")) {
      sourceLocale = "en";
    } else if (detectedLocales.includes("en-US")) {
      sourceLocale = "en-US";
    } else if (detectedLocales.length > 0) {
      sourceLocale = detectedLocales[0]!;
    }
  }

  if (targetLocales.length === 0) {
    targetLocales = detectedLocales.filter((l) => l !== sourceLocale);
  }

  // If user config has explicit namespaces, merge them
  if (userConfig?.namespaces) {
    for (const ns of Object.values(userConfig.namespaces)) {
      namespacesSet.add(ns);
    }
  }

  // 6. Check Namespace consistency across locales
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

  // 7. Detect Translation Access Patterns in source code
  const sourceFiles = await findFilesByGlob("src/**/*.{ts,tsx,js,jsx}", projectRoot, [
    "**/node_modules/**",
    "**/dist/**",
    "**/__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
  ]);

  // Sample a reasonable number of source files to detect access patterns quickly
  const sampleFiles = sourceFiles.slice(0, 30);
  for (const relPath of sampleFiles) {
    const content = await readTextFile(path.join(projectRoot, relPath));
    if (!content) continue;

    if (content.includes("useTranslation")) {
      accessPatterns.add("useTranslation");
    }
    if (/\bt\s*\(/.test(content)) {
      accessPatterns.add("t");
    }
    if (/i18n\.t\s*\(/.test(content)) {
      accessPatterns.add("i18n.t");
    }
    if (content.includes("<Trans") || content.includes("</Trans>")) {
      accessPatterns.add("Trans");
    }
  }

  const detected = library !== "none" || localeDirectory !== null || configFile !== undefined;

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
    },
    namespaces: Array.from(namespacesSet).sort(),
    accessPatterns: Array.from(accessPatterns).sort(),
    warnings,
  };
}
