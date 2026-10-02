import type { I18nSetupPlan } from "./setup.js";

export type PlanAction =
  | "CREATE"
  | "REUSE"
  | "REPLACE"
  | "REVIEW"
  | "SKIP";

export type MatchType =
  | "EXACT"
  | "NORMALIZED"
  | "SEMANTIC"
  | "NONE";

export interface CodeChange {
  type: "ADD_IMPORT" | "ADD_HOOK" | "MODIFY_IMPORT";
  value: string;
  module?: string;
}

export interface TranslationTargetLocale {
  locale: string;
  action: "CREATE_TRANSLATION" | "MISSING_TRANSLATION" | "EXISTING_TRANSLATION";
  value?: string;
  filePath?: string;
}

export interface TranslationPlan {
  namespace: string;
  key: string;
  sourceText: string;
  action: PlanAction;
  matchType: MatchType;
  matchConfidence?: number;
  existingKey?: string;
  existingNamespace?: string;
  sourceLocale: {
    locale: string;
    value: string;
    filePath?: string;
  };
  targets: TranslationTargetLocale[];
  variables?: string[];
  occurrences: number;
  isPlural?: boolean;
  pluralVariable?: string;
  pluralForm?: {
    one: string;
    other: string;
  };
  isRichText?: boolean;
  richTextComponents?: Record<string, string>;
}

export interface SourceChangePlan {
  action: PlanAction;
  file: string;
  location: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  };
  source: string;
  replacement: string;
  namespace: string;
  key: string;
  reason?: string;
  confidence?: number;
  status?: "SUPPORTED" | "UNSUPPORTED";
  requiredCodeChanges?: CodeChange[];
}

export interface PlanSummary {
  totalDetected: number;
  userFacingCount: number;
  ignoredCount: number;
  reusedKeysCount: number;
  newKeysCount: number;
  requiresReviewCount: number;
  sourceFilesAffected: number;
  localeFilesAffected: number;
}

export interface PlanWarning {
  code: string;
  message: string;
  file?: string;
  severity: "info" | "warning" | "error";
}

export interface PlanError {
  code: string;
  message: string;
  details?: unknown;
}

export interface I18nPlan {
  version: string;
  project: {
    root: string;
    framework: string;
    library?: string;
  };
  scope: {
    include: string[];
    exclude: string[];
  };
  locales: {
    source: string;
    targets: string[];
  };
  summary: PlanSummary;
  translations: TranslationPlan[];
  sourceChanges: SourceChangePlan[];
  setup?: I18nSetupPlan;
  warnings: PlanWarning[];
  errors: PlanError[];
}

export interface GenerateI18nPlanInput {
  projectPath?: string;
  path?: string;
  scope?: string | string[];
  include?: string[];
  exclude?: string[];
  sourceLocale?: string;
  targetLocales?: string[];
  confidenceThreshold?: number;
  includeAmbiguous?: boolean;
  candidateDecisions?: Record<string, boolean>;
}
