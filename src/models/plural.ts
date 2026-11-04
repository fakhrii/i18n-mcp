export type CldrPluralCategory =
  | "zero"
  | "one"
  | "two"
  | "few"
  | "many"
  | "other";

export type PluralFormat =
  | "ICU_PLURAL"
  | "ICU_SELECT"
  | "I18NEXT_SUFFIX"
  | "XCSTRINGS_PLURAL"
  | "ANDROID_PLURALS";

export type PluralIssueType =
  | "MISSING_REQUIRED_PLURAL"
  | "MISSING_OTHER_FALLBACK"
  | "INVALID_PLURAL_CATEGORY"
  | "MISSING_GENDER_BRANCH"
  | "VARIABLE_MISMATCH_IN_BRANCH";

export interface PluralIssue {
  id: string;
  file: string;
  key: string;
  locale: string;
  format: PluralFormat;
  issueType: PluralIssueType;
  severity: "error" | "warning";
  variableName?: string;
  expectedCategories: string[];
  actualCategories: string[];
  missingCategories: string[];
  message: string;
  autoFixable: boolean;
  suggestedContent?: string;
}

export interface PluralAuditOptions {
  projectPath?: string;
  locales?: string[];
  namespaces?: string[];
  fix?: boolean;
  dryRun?: boolean;
}

export interface PluralAuditResult {
  totalCatalogs: number;
  totalPluralsAudited: number;
  totalIssues: number;
  missingCategoriesCount: number;
  missingOtherFallbackCount: number;
  invalidCategoriesCount: number;
  issues: PluralIssue[];
  filesAffected: string[];
  fixesApplied?: number;
  filesModified?: string[];
  diff?: string;
}
