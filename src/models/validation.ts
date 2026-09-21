export type ValidationIssueType =
  | "MISSING_TRANSLATION"
  | "MISSING_VARIABLE"
  | "ORPHAN_KEY"
  | "MALFORMED_JSON"
  | "HARDCODED_STRING"
  | "UNRESOLVED_KEY";

export interface I18nValidationIssue {
  type: ValidationIssueType;
  severity: "error" | "warning";
  namespace: string;
  key?: string;
  locale?: string;
  file?: string;
  message: string;
}

export interface ValidateI18nInput {
  projectPath?: string;
  locales?: string[];
  namespaces?: string[];
  checkSourceCode?: boolean;
  scope?: string[];
}

export interface I18nValidationResult {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: I18nValidationIssue[];
  summary: {
    totalKeys: number;
    localesChecked: string[];
    namespacesChecked: string[];
  };
}
