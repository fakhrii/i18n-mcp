import type { I18nValidationResult } from "./validation.js";

export type InternationalizeStatus =
  | "NO_CHANGES"
  | "PLAN_READY"
  | "APPLIED"
  | "APPLIED_WITH_WARNINGS"
  | "PENDING_TRANSLATIONS"
  | "REVIEW_REQUIRED"
  | "FAILED"
  | "FAILED_VALIDATION";

export interface InternationalizeInput {
  projectPath?: string;
  scope?: string[];
  sourceLocale?: string;
  targetLocales?: string[];
  dryRun?: boolean;
  apply?: boolean;
  translate?: boolean;
  createBackup?: boolean;
  failOnWarnings?: boolean;
  include?: string[];
  exclude?: string[];
  namespaces?: string[];
}

export interface InternationalizeResult {
  success: boolean;
  status: InternationalizeStatus;
  project: {
    framework?: string;
    i18nLibrary?: string;
    sourceLocale?: string;
    targetLocales?: string[];
    localeDirectory?: string;
  };
  scope: string[];
  scan: {
    candidates: number;
    userFacing: number;
    technical: number;
    review: number;
  };
  plan: {
    changes: number;
    reviewItems: number;
    translationEntries: number;
  };
  apply?: {
    filesChanged: string[];
    sourceChangesApplied: number;
    translationEntriesCreated: number;
  };
  translation?: {
    translated: number;
    unchanged: number;
    pending: number;
    review: number;
  };
  validation?: I18nValidationResult;
  warnings: string[];
  errors: string[];
  diff?: string;
}
