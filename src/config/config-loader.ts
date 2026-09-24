import * as path from "node:path";
import type { I18nMcpConfig } from "../models/config.js";
import { fileExists, readJsonFile, readTextFile, toPosixPath } from "../utils/file-system.js";
import { logger } from "../utils/logger.js";

export const CONFIG_FILE_NAME = "i18n-mcp.config.json";

interface RawPackageJson {
  i18n?: Record<string, unknown>;
  i18next?: Record<string, unknown>;
  locales?: unknown;
}

interface RawI18nParserConfig {
  locales?: string[];
  defaultNamespace?: string;
  output?: string;
  input?: string[];
  lexir?: Record<string, unknown>;
}

/**
 * Normalizes various config shapes into a standardized I18nMcpConfig.
 */
function normalizeConfig(raw: Record<string, unknown>): I18nMcpConfig {
  const result: I18nMcpConfig = {};

  if (raw.framework && typeof raw.framework === "string") {
    result.framework = raw.framework as any;
  }
  if (raw.library && typeof raw.library === "string") {
    result.library = raw.library as any;
  }
  if (raw.keyStyle && typeof raw.keyStyle === "string") {
    result.keyStyle = raw.keyStyle as any;
  }
  if (raw.localeDirectory && typeof raw.localeDirectory === "string") {
    result.localeDirectory = toPosixPath(raw.localeDirectory);
  }
  if (Array.isArray(raw.include)) {
    result.include = raw.include.filter((i): i is string => typeof i === "string");
  }
  if (Array.isArray(raw.exclude)) {
    result.exclude = raw.exclude.filter((e): e is string => typeof e === "string");
  }
  if (raw.namespaces && typeof raw.namespaces === "object" && !Array.isArray(raw.namespaces)) {
    result.namespaces = raw.namespaces as Record<string, string>;
  } else if (Array.isArray(raw.namespaces)) {
    const nsObj: Record<string, string> = {};
    for (const ns of raw.namespaces) {
      if (typeof ns === "string") nsObj[ns] = ns;
    }
    result.namespaces = nsObj;
  }
  if (raw.glossary && typeof raw.glossary === "object") {
    result.glossary = raw.glossary as Record<string, string>;
  }

  // Locales normalization
  let sourceLocale: string | undefined;
  let targetLocales: string[] = [];

  if (raw.locales && typeof raw.locales === "object") {
    if (Array.isArray(raw.locales)) {
      // E.g. locales: ["en", "fr", "es"]
      const list = raw.locales.filter((l): l is string => typeof l === "string");
      sourceLocale = list.includes("en") ? "en" : list[0];
      targetLocales = list.filter((l) => l !== sourceLocale);
    } else {
      const locObj = raw.locales as Record<string, unknown>;
      if (typeof locObj.source === "string") sourceLocale = locObj.source;
      if (Array.isArray(locObj.targets)) {
        targetLocales = locObj.targets.filter((t): t is string => typeof t === "string");
      }
    }
  }

  if (typeof raw.sourceLocale === "string") {
    sourceLocale = raw.sourceLocale;
  }
  if (Array.isArray(raw.targetLocales)) {
    targetLocales = raw.targetLocales.filter((t): t is string => typeof t === "string");
  }
  if (Array.isArray(raw.supportedLngs)) {
    const list = raw.supportedLngs.filter((l): l is string => typeof l === "string");
    if (!sourceLocale) {
      sourceLocale = list.includes("en") ? "en" : list[0];
    }
    targetLocales = Array.from(new Set([...targetLocales, ...list.filter((l) => l !== sourceLocale)]));
  }

  if (sourceLocale || targetLocales.length > 0) {
    result.locales = {
      source: sourceLocale || "en",
      targets: targetLocales,
    };
  }

  return result;
}

/**
 * Parses i18next-parser or i18n js config files using safe static regex extraction.
 */
function parseJsConfigFile(content: string): I18nMcpConfig | null {
  const result: Record<string, unknown> = {};

  // Extract locales: ['en', 'fr', 'es']
  const localesMatch = content.match(/locales\s*:\s*\[([^\]]+)\]/);
  if (localesMatch && localesMatch[1]) {
    const locales = localesMatch[1]
      .split(",")
      .map((s) => s.replace(/['"\s]/g, ""))
      .filter(Boolean);
    if (locales.length > 0) {
      result.locales = locales;
    }
  }

  // Extract defaultNamespace: 'common' or defaultNS: 'common'
  const nsMatch = content.match(/(?:defaultNamespace|defaultNS)\s*:\s*['"]([^'"]+)['"]/);
  if (nsMatch && nsMatch[1]) {
    result.namespaces = { [nsMatch[1]]: nsMatch[1] };
  }

  // Extract output: 'locales/$LOCALE/$NAMESPACE.json'
  const outputMatch = content.match(/output\s*:\s*['"]([^'"]+)['"]/);
  if (outputMatch && outputMatch[1]) {
    const outputDir = outputMatch[1].split("$LOCALE")[0];
    if (outputDir) {
      result.localeDirectory = outputDir.replace(/\/+$/, "");
    }
  }

  return Object.keys(result).length > 0 ? normalizeConfig(result) : null;
}

/**
 * Loads project configuration from all supported project configuration files:
 * 1. i18n-mcp.config.json
 * 2. i18n.config.json
 * 3. package.json ("i18n", "i18next", or "locales" field)
 * 4. i18next-parser.config.json
 * 5. i18n.config.js / .cjs / i18next-parser.config.js / .cjs
 */
export async function loadProjectConfig(projectRoot: string): Promise<I18nMcpConfig | null> {
  // 1. Try i18n-mcp.config.json
  const mcpConfigPath = path.join(projectRoot, CONFIG_FILE_NAME);
  if (await fileExists(mcpConfigPath)) {
    try {
      const config = await readJsonFile<Record<string, unknown>>(mcpConfigPath);
      if (config) {
        logger.debug(`Loaded config from ${mcpConfigPath}`);
        return normalizeConfig(config);
      }
    } catch (error) {
      logger.warn(`Config file found at ${mcpConfigPath} but could not be parsed:`, error);
    }
  }

  // 2. Try i18n.config.json
  const i18nJsonPath = path.join(projectRoot, "i18n.config.json");
  if (await fileExists(i18nJsonPath)) {
    try {
      const config = await readJsonFile<Record<string, unknown>>(i18nJsonPath);
      if (config) {
        logger.debug(`Loaded config from ${i18nJsonPath}`);
        return normalizeConfig(config);
      }
    } catch (error) {
      logger.warn(`Config file found at ${i18nJsonPath} but could not be parsed:`, error);
    }
  }

  // 3. Try package.json ("i18n", "i18next", or "locales" field)
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (await fileExists(pkgJsonPath)) {
    try {
      const pkg = await readJsonFile<RawPackageJson>(pkgJsonPath);
      if (pkg) {
        if (pkg.i18n && typeof pkg.i18n === "object") {
          logger.debug(`Loaded i18n config from package.json ("i18n" field)`);
          return normalizeConfig(pkg.i18n);
        }
        if (pkg.i18next && typeof pkg.i18next === "object") {
          logger.debug(`Loaded i18n config from package.json ("i18next" field)`);
          return normalizeConfig(pkg.i18next);
        }
        if (pkg.locales) {
          logger.debug(`Loaded i18n config from package.json ("locales" field)`);
          return normalizeConfig({ locales: pkg.locales });
        }
      }
    } catch (error) {
      logger.warn(`Could not read i18n config from package.json:`, error);
    }
  }

  // 4. Try i18next-parser.config.json
  const parserConfigPath = path.join(projectRoot, "i18next-parser.config.json");
  if (await fileExists(parserConfigPath)) {
    try {
      const parserConfig = await readJsonFile<RawI18nParserConfig>(parserConfigPath);
      if (parserConfig) {
        logger.debug(`Loaded config from ${parserConfigPath}`);
        const parsed: Record<string, unknown> = {};
        if (parserConfig.locales) parsed.locales = parserConfig.locales;
        if (parserConfig.defaultNamespace) {
          parsed.namespaces = { [parserConfig.defaultNamespace]: parserConfig.defaultNamespace };
        }
        if (parserConfig.output) {
          const outDir = parserConfig.output.split("$LOCALE")[0];
          if (outDir) parsed.localeDirectory = outDir.replace(/\/+$/, "");
        }
        return normalizeConfig(parsed);
      }
    } catch (error) {
      logger.warn(`Could not read i18next-parser.config.json:`, error);
    }
  }

  // 5. Try i18n.config.js / i18next-parser.config.js
  const jsConfigCandidates = [
    "i18n.config.js",
    "i18n.config.cjs",
    "i18n.config.ts",
    "i18next-parser.config.js",
    "i18next-parser.config.cjs",
    "i18next-parser.config.ts",
  ];

  for (const jsCandidate of jsConfigCandidates) {
    const fullPath = path.join(projectRoot, jsCandidate);
    if (await fileExists(fullPath)) {
      try {
        const content = await readTextFile(fullPath);
        if (content) {
          const parsed = parseJsConfigFile(content);
          if (parsed) {
            logger.debug(`Loaded config from ${fullPath}`);
            return parsed;
          }
        }
      } catch (error) {
        logger.warn(`Could not parse ${fullPath}:`, error);
      }
    }
  }

  return null;
}
