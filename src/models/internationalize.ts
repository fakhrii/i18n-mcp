import type { I18nValidationResult } from "./validation.js";
import type { I18nStructureType } from "./project.js";

export type InternationalizeStatus =
  | "NO_CHANGES"
  | "PLAN_READY"
  | "APPLIED"
  | "APPLIED_WITH_WARNINGS"
  | "PENDING_TRANSLATIONS"
  | "REVIEW_REQUIRED"
  | "FAILED"
  | "FAILED_VALIDATION";

import type { TranslationProviderType } from "./config.js";

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
  candidateDecisions?: Record<string, boolean>;
  providedTranslations?: Record<string, any>;
  structure?: I18nStructureType;
  provider?: TranslationProviderType;
  apiKey?: string;
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
    structureType?: I18nStructureType;
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
