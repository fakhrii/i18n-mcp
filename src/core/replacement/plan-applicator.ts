import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { I18nPlan, SourceChangePlan } from "../../models/plan.js";
import type {
  ApplyError,
  ApplyI18nPlanInput,
  ApplyI18nPlanResult,
  ApplyWarning,
} from "../../models/replacement.js";
import { prepareLocaleUpdates } from "./locale-updater.js";
import { applySourceChangesToFile } from "./ast-transformer.js";
import { generateUnifiedDiff } from "./diff-generator.js";
import {
  fileExists,
  readJsonFile,
  readTextFile,
  toPosixPath,
} from "../../utils/file-system.js";
import { logger } from "../../utils/logger.js";

/**
 * Validates plan structure before execution.
 */
function validatePlanStructure(plan: I18nPlan): ApplyError[] {
  const errors: ApplyError[] = [];

  if (!plan) {
    errors.push({ code: "PLAN_NULL", message: "Plan object is null or undefined." });
    return errors;
  }

  if (!plan.translations || !Array.isArray(plan.translations)) {
    errors.push({
      code: "INVALID_PLAN_SCHEMA",
      message: "Plan is missing 'translations' array.",
    });
  }

  if (!plan.sourceChanges || !Array.isArray(plan.sourceChanges)) {
    errors.push({
      code: "INVALID_PLAN_SCHEMA",
      message: "Plan is missing 'sourceChanges' array.",
    });
  }

  return errors;
}

/**
 * Safely applies an approved i18n migration plan to a project.
 */
export async function applyI18nPlan(
  input: ApplyI18nPlanInput
): Promise<ApplyI18nPlanResult> {
  const warnings: ApplyWarning[] = [];
  const errors: ApplyError[] = [];

  // 1. Resolve Plan
  let plan = input.plan;
  if (!plan && input.planPath) {
    const absPlanPath = path.resolve(input.planPath);
    if (!(await fileExists(absPlanPath))) {
      return {
        success: false,
        dryRun: input.dryRun ?? false,
        filesChanged: [],
        filesSkipped: [],
        sourceChangesApplied: 0,
        translationEntriesCreated: 0,
        translationsPending: 0,
        warnings: [],
        errors: [
          {
            code: "PLAN_FILE_NOT_FOUND",
            message: `Plan file not found: ${toPosixPath(absPlanPath)}`,
            file: toPosixPath(absPlanPath),
          },
        ],
      };
    }
    const parsed = await readJsonFile<I18nPlan>(absPlanPath);
    if (!parsed) {
      return {
        success: false,
        dryRun: input.dryRun ?? false,
        filesChanged: [],
        filesSkipped: [],
        sourceChangesApplied: 0,
        translationEntriesCreated: 0,
        translationsPending: 0,
        warnings: [],
        errors: [
          {
            code: "PLAN_PARSE_FAILED",
            message: `Failed to parse plan JSON: ${toPosixPath(absPlanPath)}`,
            file: toPosixPath(absPlanPath),
          },
        ],
      };
    }
    plan = parsed;
  }

  if (!plan) {
    return {
      success: false,
      dryRun: input.dryRun ?? false,
      filesChanged: [],
      filesSkipped: [],
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: 0,
      warnings: [],
      errors: [
        {
          code: "NO_PLAN_PROVIDED",
          message: "No plan object or planPath provided to apply_i18n_plan.",
        },
      ],
    };
  }

  // 2. Validate plan schema
  const schemaErrors = validatePlanStructure(plan);
  if (schemaErrors.length > 0) {
    return {
      success: false,
      dryRun: input.dryRun ?? false,
      filesChanged: [],
      filesSkipped: [],
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: 0,
      warnings: [],
      errors: schemaErrors,
    };
  }

  const projectRoot = path.resolve(
    input.projectPath || plan.project?.root || process.cwd()
  );
  logger.info(`Applying i18n plan for project at ${projectRoot}`);

  // 3. Stage Locale Changes in memory
  const localeResult = await prepareLocaleUpdates(projectRoot, plan.translations);
  warnings.push(...localeResult.warnings);
  errors.push(...localeResult.errors);

  // If locale preparation had critical errors, abort before modifying anything
  if (errors.length > 0) {
    return {
      success: false,
      dryRun: input.dryRun ?? false,
      filesChanged: [],
      filesSkipped: [],
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: localeResult.translationsPending,
      warnings,
      errors,
    };
  }

  // 4. Stage Source Code Changes in memory
  // Group by file
  const changesByFile = new Map<string, SourceChangePlan[]>();
  for (const sc of plan.sourceChanges) {
    if (sc.action === "REPLACE") {
      const list = changesByFile.get(sc.file) || [];
      list.push(sc);
      changesByFile.set(sc.file, list);
    }
  }

  const stagedSourceFiles = new Map<string, string>();
  let totalSourceChangesApplied = 0;
  const filesSkipped: string[] = [];

  // Track original contents for diff generation
  const originalFileContents = new Map<string, string>();

  for (const [relFile, fileChanges] of changesByFile.entries()) {
    const absFile = path.join(projectRoot, relFile);

    if (!(await fileExists(absFile))) {
      errors.push({
        code: "SOURCE_FILE_NOT_FOUND",
        message: `Referenced source file does not exist: ${toPosixPath(relFile)}`,
        file: toPosixPath(relFile),
      });
      continue;
    }

    const originalContent = (await readTextFile(absFile)) || "";
    originalFileContents.set(relFile, originalContent);

    const transformResult = applySourceChangesToFile(
      relFile,
      originalContent,
      fileChanges
    );

    warnings.push(...transformResult.warnings);
    errors.push(...transformResult.errors);

    if (transformResult.changesApplied > 0) {
      stagedSourceFiles.set(toPosixPath(relFile), transformResult.transformedContent);
      totalSourceChangesApplied += transformResult.changesApplied;
    } else {
      filesSkipped.push(toPosixPath(relFile));
    }
  }

  // 5. Check if any errors occurred during staging (e.g. PLAN_STALE, missing files)
  if (errors.length > 0) {
    return {
      success: false,
      dryRun: input.dryRun ?? false,
      filesChanged: [],
      filesSkipped,
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: localeResult.translationsPending,
      warnings,
      errors,
    };
  }

  // 6. Check failOnWarnings flag
  if (input.failOnWarnings && warnings.length > 0) {
    return {
      success: false,
      dryRun: input.dryRun ?? false,
      filesChanged: [],
      filesSkipped,
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: localeResult.translationsPending,
      warnings,
      errors: [
        {
          code: "ABORTED_ON_WARNINGS",
          message: `Application aborted due to ${warnings.length} warning(s) with failOnWarnings=true.`,
        },
      ],
    };
  }

  // 7. Combine all staged files (setup files + source files + locale files)
  const allStagedFiles = new Map<string, string>();

  // 7.1 Stage Setup Files if project requires greenfield i18n infrastructure setup
  if (plan.setup?.needed) {
    // Stage config & initial locale resource files
    for (const setupFile of plan.setup.filesToCreate) {
      if (!localeResult.stagedFiles.has(setupFile.path)) {
        allStagedFiles.set(setupFile.path, setupFile.content);
        originalFileContents.set(setupFile.path, "");
      }
    }

    // Stage entry file import injection
    if (plan.setup.entryFile && plan.setup.entryImportStatement) {
      const entryRelPath = plan.setup.entryFile;
      const entryAbsPath = path.join(projectRoot, entryRelPath);
      if (await fileExists(entryAbsPath)) {
        const currentEntry =
          stagedSourceFiles.get(entryRelPath) ||
          (await readTextFile(entryAbsPath)) ||
          "";
        if (!currentEntry.includes(plan.setup.entryImportStatement)) {
          let updatedEntry = currentEntry;
          const importMatches = Array.from(
            currentEntry.matchAll(/^import\s+.*from\s+['"].*['"];?/gm)
          );
          if (importMatches.length > 0) {
            const lastImport = importMatches[importMatches.length - 1]!;
            const insertPos = (lastImport.index ?? 0) + lastImport[0].length;
            updatedEntry =
              currentEntry.slice(0, insertPos) +
              `\n${plan.setup.entryImportStatement}` +
              currentEntry.slice(insertPos);
          } else {
            updatedEntry = `${plan.setup.entryImportStatement}\n` + currentEntry;
          }
          stagedSourceFiles.set(entryRelPath, updatedEntry);
          if (!originalFileContents.has(entryRelPath)) {
            originalFileContents.set(entryRelPath, currentEntry);
          }
        }
      }
    }

    // Stage package.json dependencies update
    if (plan.setup.dependenciesToAdd) {
      const pkgPath = path.join(projectRoot, "package.json");
      if (await fileExists(pkgPath)) {
        const rawPkg = await readTextFile(pkgPath);
        if (rawPkg) {
          try {
            const pkgObj = JSON.parse(rawPkg);
            pkgObj.dependencies = pkgObj.dependencies || {};
            let depsAdded = false;
            for (const [dep, ver] of Object.entries(plan.setup.dependenciesToAdd)) {
              if (
                !pkgObj.dependencies[dep] &&
                (!pkgObj.devDependencies || !pkgObj.devDependencies[dep])
              ) {
                pkgObj.dependencies[dep] = ver;
                depsAdded = true;
              }
            }
            if (depsAdded) {
              const updatedPkg = JSON.stringify(pkgObj, null, 2) + "\n";
              allStagedFiles.set("package.json", updatedPkg);
              originalFileContents.set("package.json", rawPkg);
            }
          } catch {
            // Ignore parse errors on package.json
          }
        }
      }
    }
  }

  for (const [file, content] of stagedSourceFiles.entries()) {
    allStagedFiles.set(file, content);
  }
  for (const [file, content] of localeResult.stagedFiles.entries()) {
    allStagedFiles.set(file, content);
  }

  // 8. Generate unified diff
  const diffs: string[] = [];
  for (const [relPath, newContent] of allStagedFiles.entries()) {
    let original = originalFileContents.get(relPath);
    if (original === undefined) {
      const absPath = path.join(projectRoot, relPath);
      original = (await fileExists(absPath)) ? (await readTextFile(absPath)) || "" : "";
    }
    const fileDiff = generateUnifiedDiff(relPath, original, newContent);
    if (fileDiff) {
      diffs.push(fileDiff);
    }
  }
  const completeDiff = diffs.join("\n\n");

  const filesChanged = Array.from(allStagedFiles.keys());

  // 9. If dry-run: do NOT modify disk, return staged diff
  if (input.dryRun) {
    logger.info(`Dry run complete: ${filesChanged.length} file(s) would be modified`);
    return {
      success: true,
      dryRun: true,
      filesChanged,
      filesSkipped,
      sourceChangesApplied: totalSourceChangesApplied,
      translationEntriesCreated: localeResult.translationEntriesCreated,
      translationsPending: localeResult.translationsPending,
      warnings,
      errors: [],
      diff: completeDiff,
    };
  }

  // 10. Create backups if requested
  if (input.createBackup) {
    for (const relPath of filesChanged) {
      const absPath = path.join(projectRoot, relPath);
      if (await fileExists(absPath)) {
        try {
          const original = (await readTextFile(absPath)) || "";
          await fs.writeFile(`${absPath}.bak`, original, "utf8");
        } catch (err: unknown) {
          warnings.push({
            code: "BACKUP_CREATION_FAILED",
            message: `Could not create backup for ${relPath}: ${String(err)}`,
            file: relPath,
          });
        }
      }
    }
  }

  // 11. Write all staged files to disk
  const successfullyWritten: string[] = [];
  try {
    for (const [relPath, newContent] of allStagedFiles.entries()) {
      const absPath = path.join(projectRoot, relPath);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, newContent, "utf8");
      successfullyWritten.push(relPath);
    }
  } catch (writeErr: unknown) {
    errors.push({
      code: "WRITE_FAILED",
      message: `Failed during file writing: ${String(writeErr)}. Files written: [${successfullyWritten.join(", ")}]`,
      details: {
        written: successfullyWritten,
        failed: filesChanged.filter((f) => !successfullyWritten.includes(f)),
      },
    });

    return {
      success: false,
      dryRun: false,
      filesChanged: successfullyWritten,
      filesSkipped,
      sourceChangesApplied: 0,
      translationEntriesCreated: 0,
      translationsPending: localeResult.translationsPending,
      warnings,
      errors,
      diff: completeDiff,
    };
  }

  // 12. Verification: re-read written files
  for (const relPath of successfullyWritten) {
    const absPath = path.join(projectRoot, relPath);
    const diskContent = await readTextFile(absPath);
    const expected = allStagedFiles.get(relPath);
    if (diskContent !== expected) {
      warnings.push({
        code: "WRITE_VERIFICATION_MISMATCH",
        message: `Written file content did not match expected staged content: ${relPath}`,
        file: relPath,
      });
    }
  }

  logger.info(
    `Successfully applied i18n plan: ${successfullyWritten.length} files changed, ${totalSourceChangesApplied} replacements, ${localeResult.translationEntriesCreated} locale entries`
  );

  return {
    success: true,
    dryRun: false,
    filesChanged: successfullyWritten,
    filesSkipped,
    sourceChangesApplied: totalSourceChangesApplied,
    translationEntriesCreated: localeResult.translationEntriesCreated,
    translationsPending: localeResult.translationsPending,
    warnings,
    errors: [],
    diff: completeDiff,
  };
}
