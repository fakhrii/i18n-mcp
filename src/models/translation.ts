export interface TranslateI18nInput {
  projectPath?: string;
  sourceLocale?: string;
  targetLocales?: string[];
  namespaces?: string[];
  dryRun?: boolean;
}

export type TranslationItemStatus =
  | "TRANSLATED"
  | "UNCHANGED"
  | "PENDING"
  | "REVIEW";

export interface TranslationItemResult {
  namespace: string;
  key: string;
  sourceText: string;
  translatedText: string;
  locale: string;
  status: TranslationItemStatus;
}

export interface TranslationServiceResult {
  translated: number;
  unchanged: number;
  pending: number;
  review: number;
  filesModified: string[];
  items: TranslationItemResult[];
  errors: string[];
  warnings: string[];
}
