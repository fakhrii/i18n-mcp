export type RtlIssueCategory =
  | "PHYSICAL_SPACING"
  | "PHYSICAL_POSITION"
  | "PHYSICAL_ALIGNMENT"
  | "DIRECTIONAL_ICON"
  | "DIRECTIONAL_GLYPH"
  | "MISSING_RTL_SUPPORT";

export interface RtlIssue {
  id: string;
  file: string;
  line: number;
  column: number;
  category: RtlIssueCategory;
  severity: "error" | "warning" | "info";
  propertyOrText: string;
  suggestedReplacement?: string;
  message: string;
  autoFixable: boolean;
}

export interface RtlAuditOptions {
  projectPath?: string;
  scope?: string[];
  include?: string[];
  exclude?: string[];
  targetLocales?: string[];
  fix?: boolean;
  dryRun?: boolean;
}

export interface RtlAuditResult {
  isRtlTargeted: boolean;
  rtlLocalesDetected: string[];
  totalIssues: number;
  fixableCount: number;
  issues: RtlIssue[];
  filesAffected: string[];
  fixesApplied?: number;
  diff?: string;
}
