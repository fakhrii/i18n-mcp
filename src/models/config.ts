import type { FrameworkType, I18nLibraryType, I18nStructureType } from "./project.js";

export type KeyStyle = "UPPER_SNAKE_CASE" | "lowerCamelCase" | "kebab-case" | "snake_case";

export interface I18nConfigLocales {
  source: string;
  targets: string[];
}

export interface I18nMcpConfig {
  framework?: FrameworkType;
  library?: I18nLibraryType;
  structure?: I18nStructureType;
  locales?: I18nConfigLocales;
  localeDirectory?: string;
  keyStyle?: KeyStyle;
  include?: string[];
  exclude?: string[];
  namespaces?: Record<string, string>;
  glossary?: Record<string, string>;
}
