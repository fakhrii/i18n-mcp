export type FrameworkType = "react-native" | "react" | "unknown";
export type LanguageType = "typescript" | "javascript";
export type PackageManagerType = "npm" | "yarn" | "pnpm" | "bun" | "unknown";
export type I18nLibraryType = "react-i18next" | "i18next" | "custom" | "none";

export interface I18nDetection {
  library: I18nLibraryType;
  detected: boolean;
  localeDirectory: string | null;
  sourceLocale: string;
  targetLocales: string[];
  configFile?: string;
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
}
