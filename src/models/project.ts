export type FrameworkType = "react-native" | "react" | "nextjs" | "flutter" | "angular" | "unknown";
export type LanguageType = "typescript" | "javascript" | "dart";
export type PackageManagerType = "npm" | "yarn" | "pnpm" | "bun" | "pub" | "unknown";
export type I18nLibraryType =
  | "react-i18next"
  | "i18next"
  | "next-intl"
  | "flutter_localizations"
  | "easy_localization"
  | "@ngx-translate/core"
  | "ngx-translate"
  | "@angular/localize"
  | "transloco"
  | "custom"
  | "none";

export type I18nStructureType = "namespaces" | "nested" | "flat";

export interface I18nDetection {
  library: I18nLibraryType;
  detected: boolean;
  localeDirectory: string | null;
  sourceLocale: string;
  targetLocales: string[];
  configFile?: string;
  needsSetup?: boolean;
  structureType?: I18nStructureType;
}

export interface ProjectStructure {
  featureDirectory?: string;
  features: string[];
  screenDirectory?: string;
  screens: string[];
}

export interface ConfigWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  file?: string;
}

export interface ProjectAnalysis {
  framework: FrameworkType;
  language: LanguageType;
  packageManager: PackageManagerType;
  i18n: I18nDetection;
  namespaces: string[];
  projectStructure: ProjectStructure;
  accessPatterns: string[];
  warnings: ConfigWarning[];
  structureType: I18nStructureType;
}
