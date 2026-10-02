export interface TranslateI18nInput {
  projectPath?: string;
  sourceLocale?: string;
  targetLocales?: string[];
  namespaces?: string[];
  dryRun?: boolean;
  providedTranslations?: Record<string, any>;
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
  pendingItems?: Array<{
    key: string;
    sourceText: string;
    locale: string;
    namespace?: string;
  }>;
  errors: string[];
  warnings: string[];
}
