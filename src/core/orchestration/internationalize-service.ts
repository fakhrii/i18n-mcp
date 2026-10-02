import * as path from "node:path";
import type {
  InternationalizeInput,
  InternationalizeResult,
  InternationalizeStatus,
} from "../../models/internationalize.js";
import type { I18nValidationResult } from "../../models/validation.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { scanHardcodedTexts } from "../scanner/scanner.js";
import { generateI18nPlan } from "../planning/plan-generator.js";
import { applyI18nPlan } from "../replacement/plan-applicator.js";
import { translateI18n } from "../translation/translation-service.js";
import { validateI18n } from "../validation/i18n-validator.js";
import { logger } from "../../utils/logger.js";

/**
 * End-to-end orchestrator for React Native i18n migration.
 * Coordinates: analyze -> scan -> plan -> apply -> translate -> validate.
 */
export async function internationalizeProject(
  input: InternationalizeInput = {}
): Promise<InternationalizeResult> {
  const projectRoot = path.resolve(input.projectPath || process.cwd());
  const dryRun = input.dryRun ?? true; // Conservative default
  const apply = input.apply ?? false; // Conservative default
  const translate = input.translate ?? false; // Conservative default
  const createBackup = input.createBackup ?? false;
  const failOnWarnings = input.failOnWarnings ?? false;
  const scope = input.scope || [];

  const warnings: string[] = [];
  const errors: string[] = [];

  logger.info(
    `Starting internationalization pipeline for ${projectRoot} (dryRun=${dryRun}, apply=${apply}, translate=${translate})`
  );

  // 1. Analyze Project
  let analysis;
  try {
    analysis = await analyzeProject(projectRoot);
  } catch (err: unknown) {
    return {
      success: false,
      status: "FAILED",
      project: {},
      scope,
      scan: { candidates: 0, userFacing: 0, technical: 0, review: 0 },
      plan: { changes: 0, reviewItems: 0, translationEntries: 0 },
      warnings,
      errors: [`Project analysis failed: ${String(err)}`],
    };
  }

  const sourceLocale = input.sourceLocale || analysis.i18n.sourceLocale || "en";
  const targetLocales =
    input.targetLocales && input.targetLocales.length > 0
      ? input.targetLocales
      : analysis.i18n.targetLocales;

  const projectMeta = {
    framework: analysis.framework,
    i18nLibrary: analysis.i18n.library,
    sourceLocale,
    targetLocales,
    localeDirectory: analysis.i18n.localeDirectory || undefined,
  };

  for (const w of analysis.warnings) {
    warnings.push(w.message);
  }

  // 2. Scan Hardcoded Texts
  let scanResult;
  try {
    scanResult = await scanHardcodedTexts(projectRoot, {
      scope: input.scope,
      include: input.include,
      exclude: input.exclude,
    });
  } catch (err: unknown) {
    return {
      success: false,
      status: "FAILED",
      project: projectMeta,
      scope,
      scan: { candidates: 0, userFacing: 0, technical: 0, review: 0 },
      plan: { changes: 0, reviewItems: 0, translationEntries: 0 },
      warnings,
      errors: [`Hardcoded text scan failed: ${String(err)}`],
    };
  }

  const scanReviewCount = scanResult.items.filter((i) => i.confidence < 0.7).length;
  const scanMeta = {
    candidates: scanResult.total,
    userFacing: scanResult.userFacingCount,
    technical: scanResult.technicalCount,
    review: scanReviewCount,
  };

  // Early exit optimization: If 0 hardcoded strings found in scan, return NO_CHANGES
  if (scanResult.userFacingCount === 0) {
    logger.info("No hardcoded user-facing strings detected. Early exit: NO_CHANGES.");
    return {
      success: true,
      status: "NO_CHANGES",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: { changes: 0, reviewItems: 0, translationEntries: 0 },
      warnings,
      errors,
    };
  }

  // 3. Generate i18n Plan
  let plan;
  try {
    plan = await generateI18nPlan({
      projectPath: projectRoot,
      scope: input.scope,
      include: input.include,
      exclude: input.exclude,
      sourceLocale,
      targetLocales,
      candidateDecisions: input.candidateDecisions,
    });
  } catch (err: unknown) {
    return {
      success: false,
      status: "FAILED",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: { changes: 0, reviewItems: 0, translationEntries: 0 },
      warnings,
      errors: [`Plan generation failed: ${String(err)}`],
    };
  }

  for (const pw of plan.warnings) {
    warnings.push(pw.message);
  }

  for (const pe of plan.errors) {
    errors.push(pe.message);
  }

  if (plan.setup?.needed) {
    projectMeta.i18nLibrary = plan.setup.library;
    projectMeta.localeDirectory = plan.setup.localeDirectory;
  }

  const planChangesCount = plan.sourceChanges.filter(
    (sc) => sc.action === "REPLACE"
  ).length;
  const planReviewCount = plan.summary.requiresReviewCount;
  const translationEntriesCount = plan.translations.length;

  const planMeta = {
    changes: planChangesCount,
    reviewItems: planReviewCount,
    translationEntries: translationEntriesCount,
  };

  // If plan has no changes or translations needed
  if (planChangesCount === 0 && translationEntriesCount === 0) {
    return {
      success: true,
      status: "NO_CHANGES",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: planMeta,
      warnings,
      errors,
    };
  }

  // 4. Dry Run / Plan Only Mode (Stop here if apply is false or dryRun is true)
  if (!apply || dryRun) {
    let diff: string | undefined;
    try {
      const dryRunApplyResult = await applyI18nPlan({
        projectPath: projectRoot,
        plan,
        dryRun: true,
      });
      diff = dryRunApplyResult.diff;
    } catch (err: unknown) {
      warnings.push(`Could not compute dry-run diff: ${String(err)}`);
    }

    if (failOnWarnings && warnings.length > 0) {
      return {
        success: false,
        status: "FAILED",
        project: projectMeta,
        scope,
        scan: scanMeta,
        plan: planMeta,
        warnings,
        errors: [`Aborted due to ${warnings.length} warning(s) with failOnWarnings=true.`],
        diff,
      };
    }

    return {
      success: true,
      status: "PLAN_READY",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: planMeta,
      warnings,
      errors,
      diff,
    };
  }

  // 5. Apply i18n Plan
  let applyResult;
  try {
    applyResult = await applyI18nPlan({
      projectPath: projectRoot,
      plan,
      dryRun: false,
      createBackup,
      failOnWarnings,
    });
  } catch (err: unknown) {
    return {
      success: false,
      status: "FAILED",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: planMeta,
      warnings,
      errors: [`Plan application failed: ${String(err)}`],
    };
  }

  for (const aw of applyResult.warnings) {
    warnings.push(aw.message);
  }

  for (const ae of applyResult.errors) {
    errors.push(ae.message);
  }

  if (!applyResult.success) {
    return {
      success: false,
      status: "FAILED",
      project: projectMeta,
      scope,
      scan: scanMeta,
      plan: planMeta,
      apply: {
        filesChanged: applyResult.filesChanged,
        sourceChangesApplied: applyResult.sourceChangesApplied,
        translationEntriesCreated: applyResult.translationEntriesCreated,
      },
      warnings,
      errors,
      diff: applyResult.diff,
    };
  }

  const applyMeta = {
    filesChanged: applyResult.filesChanged,
    sourceChangesApplied: applyResult.sourceChangesApplied,
    translationEntriesCreated: applyResult.translationEntriesCreated,
  };

  // 6. Translate target locales (if requested)
  let transMeta:
    | {
        translated: number;
        unchanged: number;
        pending: number;
        review: number;
      }
    | undefined;

  let translationResult;
  if (translate) {
    try {
      translationResult = await translateI18n({
        projectPath: projectRoot,
        sourceLocale,
        targetLocales,
        namespaces: input.namespaces,
        dryRun: false,
        providedTranslations: input.providedTranslations,
      });

      transMeta = {
        translated: translationResult.translated,
        unchanged: translationResult.unchanged,
        pending: translationResult.pending,
        review: translationResult.review,
      };

      warnings.push(...translationResult.warnings);
      errors.push(...translationResult.errors);
    } catch (err: unknown) {
      errors.push(`Translation phase failed: ${String(err)}`);
    }
  }

  // 7. Validate i18n implementation
  let validationResult: I18nValidationResult;
  try {
    validationResult = await validateI18n({
      projectPath: projectRoot,
      locales: [sourceLocale, ...targetLocales],
      namespaces: input.namespaces,
      checkSourceCode: false,
    });
  } catch (err: unknown) {
    validationResult = {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      issues: [
        {
          type: "MALFORMED_JSON",
          severity: "error",
          namespace: "common",
          message: `Validation failed to execute: ${String(err)}`,
        },
      ],
      summary: {
        totalKeys: 0,
        localesChecked: [],
        namespacesChecked: [],
      },
    };
  }

  for (const issue of validationResult.issues) {
    if (issue.severity === "error") {
      errors.push(`[${issue.type}] ${issue.message}`);
    } else {
      warnings.push(`[${issue.type}] ${issue.message}`);
    }
  }

  // 8. Determine Final Status
  let finalStatus: InternationalizeStatus;
  let finalSuccess = true;

  if (!validationResult.valid || errors.length > 0) {
    finalStatus = !validationResult.valid ? "FAILED_VALIDATION" : "FAILED";
    finalSuccess = false;
  } else if (translationResult && translationResult.pending > 0) {
    finalStatus = "PENDING_TRANSLATIONS";
  } else if (planReviewCount > 0 || (translationResult && translationResult.review > 0)) {
    finalStatus = "REVIEW_REQUIRED";
  } else if (warnings.length > 0) {
    finalStatus = "APPLIED_WITH_WARNINGS";
  } else {
    finalStatus = "APPLIED";
  }

  if (failOnWarnings && warnings.length > 0) {
    finalSuccess = false;
    finalStatus = "FAILED";
    errors.push(`Aborted due to ${warnings.length} warning(s) with failOnWarnings=true.`);
  }

  logger.info(`Internationalize workflow completed with status: ${finalStatus}`);

  return {
    success: finalSuccess,
    status: finalStatus,
    project: projectMeta,
    scope,
    scan: scanMeta,
    plan: planMeta,
    apply: applyMeta,
    translation: transMeta,
    validation: validationResult,
    warnings,
    errors,
    diff: applyResult.diff,
  };
}
