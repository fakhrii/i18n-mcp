export type FormattingIssueCategory =
  | "CURRENCY"
  | "NUMBER"
  | "PERCENTAGE"
  | "DATE"
  | "TIME";

export interface FormattingIssue {
  id: string;
  file: string;
  line: number;
  column: number;
  category: FormattingIssueCategory;
  severity: "error" | "warning";
  rawExpression: string;
  detectedSymbolOrMethod?: string;
  framework?: string;
  message: string;
  suggestedReplacement?: string;
  autoFixable: boolean;
}

export interface FormattingAuditOptions {
  projectPath?: string;
  scope?: string[];
  include?: string[];
  exclude?: string[];
  categories?: FormattingIssueCategory[];
  fix?: boolean;
  dryRun?: boolean;
}

export interface FormattingAuditResult {
  projectRoot: string;
  framework: string;
  totalIssues: number;
  currencyIssuesCount: number;
  numberIssuesCount: number;
  percentageIssuesCount: number;
  dateIssuesCount: number;
  timeIssuesCount?: number;
  fixableCount: number;
  issues: FormattingIssue[];
  filesAffected: string[];
  fixesApplied?: number;
  filesModified?: string[];
  diff?: string;
}
