export type TranslationExchangeFormat = "xliff-1.2" | "xliff-2.0" | "tmx-1.4";

export type TranslationUnitState =
  | "new"
  | "needs-translation"
  | "translated"
  | "final";

export interface TranslationExchangeUnit {
  id: string;
  source: string;
  target?: string;
  namespace?: string;
  note?: string;
  state?: TranslationUnitState;
}

export interface ExportTranslationsOptions {
  projectPath?: string;
  format?: TranslationExchangeFormat;
  sourceLocale?: string;
  targetLocales?: string[];
  namespaces?: string[];
  outputPath?: string;
  includeEmptyTranslations?: boolean;
  includeNotes?: boolean;
}

export interface ExportTranslationsResult {
  projectRoot: string;
  format: TranslationExchangeFormat;
  sourceLocale: string;
  targetLocales: string[];
  filesExported: string[];
  totalUnitsExported: number;
  content?: string;
}

export interface ImportTranslationsOptions {
  projectPath?: string;
  filePath?: string;
  content?: string;
  format?: TranslationExchangeFormat;
  targetLocales?: string[];
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface ImportTranslationsResult {
  projectRoot: string;
  format: TranslationExchangeFormat;
  sourceLocale?: string;
  targetLocale?: string;
  unitsProcessed: number;
  unitsImported: number;
  unitsSkipped: number;
  filesModified: string[];
  dryRun: boolean;
  diff?: string;
}
