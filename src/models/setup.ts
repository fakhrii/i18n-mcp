import type { I18nLibraryType } from "./project.js";

export interface I18nSetupFile {
  path: string;
  content: string;
  type: "CONFIG" | "LOCALE_RESOURCE" | "ENTRY_INJECTION" | "PACKAGE_JSON";
}

export interface I18nSetupPlan {
  needed: boolean;
  library: I18nLibraryType;
  configFile: string;
  localeDirectory: string;
  entryFile?: string;
  entryImportStatement?: string;
  filesToCreate: I18nSetupFile[];
  dependenciesToAdd: Record<string, string>;
}
