import type { I18nPlan } from "./plan.js";

export interface ApplyWarning {
  code: string;
  message: string;
  file?: string;
}

export interface ApplyError {
  code: string;
  message: string;
  file?: string;
  details?: unknown;
}

export interface ApplyI18nPlanInput {
  plan?: I18nPlan;
  planPath?: string;
  projectPath?: string;
  dryRun?: boolean;
  createBackup?: boolean;
  failOnWarnings?: boolean;
}

export interface ApplyI18nPlanResult {
  success: boolean;
  dryRun: boolean;
  filesChanged: string[];
  filesSkipped: string[];
  sourceChangesApplied: number;
  translationEntriesCreated: number;
  translationsPending: number;
  warnings: ApplyWarning[];
  errors: ApplyError[];
  diff?: string;
}
