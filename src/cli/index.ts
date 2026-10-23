#!/usr/bin/env node

import { Command } from "commander";
import { analyzeProject } from "../core/discovery/project-analyzer.js";
import { I18nMcpError } from "../models/errors.js";

const program = new Command();

program
  .name("i18n-mcp")
  .description("CLI and developer tool for automated internationalization across React Native, React, Next.js, Flutter, and Angular")
  .version("0.1.4");

program
  .command("serve")
  .description("Start the MCP server on stdio for AI clients")
  .action(async () => {
    const { startStdioServer } = await import("../mcp/server.js");
    await startStdioServer();
  });

program
  .command("analyze")
  .description("Analyze project structure, existing i18n configuration, and namespaces")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--json", "Output results strictly as JSON", false)
  .action(async (projectPath: string, options: { json: boolean }) => {
    try {
      const result = await analyzeProject(projectPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log("\n--- Project i18n Analysis ---\n");
      console.log(`Framework:       ${result.framework}`);
      console.log(`Language:        ${result.language}`);
      console.log(`Package Manager: ${result.packageManager}`);
      console.log("\ni18n Configuration:");
      console.log(`  Library:         ${result.i18n.library}`);
      console.log(`  Detected:        ${result.i18n.detected}`);
      console.log(`  Locale Directory:${result.i18n.localeDirectory ?? " (none)"}`);
      console.log(`  Source Locale:   ${result.i18n.sourceLocale}`);
      console.log(`  Target Locales:  [${result.i18n.targetLocales.join(", ")}]`);
      if (result.i18n.configFile) {
        console.log(`  Config File:     ${result.i18n.configFile}`);
      }

      console.log(`\nNamespaces:      [${result.namespaces.join(", ")}]`);

      console.log("\nProject Structure:");
      if (result.projectStructure.featureDirectory) {
        console.log(`  Feature Dir:     ${result.projectStructure.featureDirectory}`);
        console.log(`  Features:        [${result.projectStructure.features.join(", ")}]`);
      }
      if (result.projectStructure.screenDirectory) {
        console.log(`  Screen Dir:      ${result.projectStructure.screenDirectory}`);
        console.log(`  Screens:         [${result.projectStructure.screens.join(", ")}]`);
      }

      if (result.accessPatterns.length > 0) {
        console.log(`\nAccess Patterns: [${result.accessPatterns.join(", ")}]`);
      }

      if (result.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of result.warnings) {
          console.log(`  [${w.severity.toUpperCase()}] ${w.code}: ${w.message}`);
        }
      }

      console.log("\n----------------------------------\n");
    } catch (error: unknown) {
      if (error instanceof I18nMcpError) {
        console.error(`Error (${error.code}): ${error.message}`);
      } else {
        console.error("Analysis failed:", error);
      }
      process.exit(1);
    }
  });

program
  .command("scan")
  .description("Scan project for hardcoded strings using AST analysis")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--scope <scope...>", "Limit scanning to specific file(s), directory, or glob pattern")
  .option("--include <patterns...>", "Glob patterns to include")
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .option("--all", "Include technical and non-user-facing strings", false)
  .option("--min-confidence <number>", "Minimum confidence threshold (0.0 to 1.0)", "0.0")
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        scope?: string[];
        include?: string[];
        exclude?: string[];
        all: boolean;
        minConfidence: string;
        json: boolean;
      }
    ) => {
      try {
        const { scanHardcodedTexts } = await import(
          "../core/scanner/scanner.js"
        );
        const minConf = parseFloat(options.minConfidence) || 0.0;

        const result = await scanHardcodedTexts(projectPath, {
          scope: options.scope,
          include: options.include,
          exclude: options.exclude,
          onlyUserFacing: !options.all,
          minConfidence: minConf,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- Hardcoded Strings AST Scan ---\n");
        console.log(`Path:              ${projectPath}`);
        console.log(`Duration:          ${result.durationMs}ms`);
        console.log(`Total Detected:    ${result.total}`);
        console.log(`User-facing:       ${result.userFacingCount}`);
        console.log(`Technical:         ${result.technicalCount}`);
        console.log("\nDetected Strings:");

        if (result.items.length === 0) {
          console.log("  (No strings matched the scan criteria)\n");
          return;
        }

        for (const item of result.items) {
          console.log(
            `\n  [${item.confidenceLevel} ${Math.round(item.confidence * 100)}%] "${item.text}"`
          );
          console.log(`    Location:   ${item.file}:${item.line}:${item.column}`);
          console.log(`    Type:       ${item.type}`);
          console.log(`    Class:      ${item.classification}`);
          console.log(
            `    Suggested:  ${item.suggestedNamespace}:${item.suggestedKey}`
          );
          console.log(`    Reason:     ${item.reason}`);
          if (item.variables && item.variables.length > 0) {
            console.log(`    Variables:  [${item.variables.join(", ")}]`);
          }
        }

        console.log("\n----------------------------------\n");
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Scan failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("plan")
  .description("Generate deterministic i18n migration plan without modifying any files")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--scope <scope...>", "Limit planning to specific file(s), directory, or glob pattern")
  .option("--include <patterns...>", "Glob patterns to include")
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .option("--source-locale <locale>", "Source locale (e.g. 'en')")
  .option("--target-locales <locales...>", "Target locales (e.g. 'fr' 'es')")
  .option("--min-confidence <number>", "Minimum confidence threshold (0.0 to 1.0)", "0.7")
  .option("--include-ambiguous", "Include ambiguous strings marked for review", false)
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        scope?: string[];
        include?: string[];
        exclude?: string[];
        sourceLocale?: string;
        targetLocales?: string[];
        minConfidence: string;
        includeAmbiguous: boolean;
        json: boolean;
      }
    ) => {
      try {
        const { generateI18nPlan } = await import(
          "../core/planning/plan-generator.js"
        );
        const minConf = parseFloat(options.minConfidence) || 0.7;

        const plan = await generateI18nPlan({
          projectPath,
          scope: options.scope,
          include: options.include,
          exclude: options.exclude,
          sourceLocale: options.sourceLocale,
          targetLocales: options.targetLocales,
          confidenceThreshold: minConf,
          includeAmbiguous: options.includeAmbiguous,
        });

        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
          return;
        }

        console.log("\n--- i18n Migration Plan ---\n");
        console.log(`Project:           ${plan.project.root} (${plan.project.framework}, ${plan.project.library || "none"})`);
        console.log(`Locales:           source=${plan.locales.source}, targets=[${plan.locales.targets.join(", ")}]`);
        console.log("\nSummary:");
        console.log(`  Total Detected:        ${plan.summary.totalDetected}`);
        console.log(`  User-facing Strings:   ${plan.summary.userFacingCount}`);
        console.log(`  Ignored (Technical):   ${plan.summary.ignoredCount}`);
        console.log(`  Existing Keys Reused:  ${plan.summary.reusedKeysCount}`);
        console.log(`  New Keys to Create:    ${plan.summary.newKeysCount}`);
        console.log(`  Requires Review:       ${plan.summary.requiresReviewCount}`);
        console.log(`  Source Files Affected: ${plan.summary.sourceFilesAffected}`);
        console.log(`  Locale Files Affected: ${plan.summary.localeFilesAffected}`);

        console.log(`\nProposed Translations (${plan.translations.length}):`);
        for (const t of plan.translations) {
          const matchInfo =
            t.matchType && t.matchType !== "NONE"
              ? ` [Match: ${t.matchType}${t.matchConfidence ? ` ${Math.round(t.matchConfidence * 100)}%` : ""}]`
              : "";
          const occInfo = t.occurrences > 1 ? ` (${t.occurrences} occurrences)` : "";
          console.log(`  [${t.action}] ${t.namespace}:${t.key} ("${t.sourceText}")${matchInfo}${occInfo}`);
        }

        console.log(`\nProposed Source Changes (${plan.sourceChanges.length}):`);
        for (const s of plan.sourceChanges.slice(0, 20)) {
          const req = s.requiredCodeChanges?.length
            ? ` (Requires: ${s.requiredCodeChanges.map((c) => c.value).join(", ")})`
            : "";
          console.log(`  [${s.action}] ${s.file}:${s.location.line}:${s.location.column} -> ${s.replacement}${req}`);
        }
        if (plan.sourceChanges.length > 20) {
          console.log(`  ... and ${plan.sourceChanges.length - 20} more change(s)`);
        }

        if (plan.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of plan.warnings) {
            console.log(`  [${w.severity.toUpperCase()}] ${w.code}: ${w.message}`);
          }
        }

        console.log("\n----------------------------------------\n");
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Plan generation failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("apply")
  .description("Safely apply an approved i18n plan to the project")
  .argument("[plan-or-project]", "Path to plan JSON file or project root directory", ".")
  .option("--dry-run", "Simulate changes and print diff without writing to disk", false)
  .option("--create-backup", "Create .bak copies of files before modifying them", false)
  .option("--fail-on-warnings", "Abort execution if any warnings occur", false)
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      target: string,
      options: {
        dryRun: boolean;
        createBackup: boolean;
        failOnWarnings: boolean;
        json: boolean;
      }
    ) => {
      try {
        const { applyI18nPlan } = await import(
          "../core/replacement/plan-applicator.js"
        );
        const { generateI18nPlan } = await import(
          "../core/planning/plan-generator.js"
        );
        const { fileExists } = await import("../utils/file-system.js");

        let planToApply: import("../models/plan.js").I18nPlan | undefined;
        let projectPath: string | undefined;

        if (target.endsWith(".json") && (await fileExists(target))) {
          const { readJsonFile } = await import("../utils/file-system.js");
          planToApply = await readJsonFile(target) || undefined;
        } else {
          // If a directory was provided, generate the plan first in memory
          projectPath = target;
          planToApply = await generateI18nPlan({ projectPath });
        }

        const result = await applyI18nPlan({
          plan: planToApply,
          projectPath,
          dryRun: options.dryRun,
          createBackup: options.createBackup,
          failOnWarnings: options.failOnWarnings,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- i18n Plan Application ---\n");
        console.log(`Status:                  ${result.success ? (result.dryRun ? "Dry-run SUCCESS" : "APPLIED") : "FAILED"}`);
        console.log(`Dry-run:                 ${result.dryRun}`);
        console.log(`Files Modified:          ${result.filesChanged.length}`);
        console.log(`Files Skipped:           ${result.filesSkipped.length}`);
        console.log(`Source Changes Applied:  ${result.sourceChangesApplied}`);
        console.log(`Locale Keys Created:     ${result.translationEntriesCreated}`);
        console.log(`Translations Pending:    ${result.translationsPending}`);

        if (result.filesChanged.length > 0) {
          console.log(`\nModified Files:`);
          for (const f of result.filesChanged) {
            console.log(`  - ${f}`);
          }
        }

        if (result.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of result.warnings) {
            console.log(`  [${w.code}] ${w.file ? `${w.file}: ` : ""}${w.message}`);
          }
        }

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          for (const e of result.errors) {
            console.log(`  [${e.code}] ${e.file ? `${e.file}: ` : ""}${e.message}`);
          }
        }

        if (result.diff) {
          console.log("\nUnified Diff:");
          console.log(result.diff);
        }

        console.log("\n------------------------------------------\n");

        if (!result.success) {
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Application failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("translate")
  .description("Translate missing keys in target locale files")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--source-locale <locale>", "Source locale (e.g. 'en')")
  .option("--target-locales <locales...>", "Target locales to translate to (e.g. 'fr' 'es')")
  .option("--namespaces <namespaces...>", "Limit translation to specific namespaces")
  .option("--dry-run", "Simulate translation without modifying files", false)
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        sourceLocale?: string;
        targetLocales?: string[];
        namespaces?: string[];
        dryRun: boolean;
        json: boolean;
      }
    ) => {
      try {
        const { translateI18n } = await import(
          "../core/translation/translation-service.js"
        );

        const result = await translateI18n({
          projectPath,
          sourceLocale: options.sourceLocale,
          targetLocales: options.targetLocales,
          namespaces: options.namespaces,
          dryRun: options.dryRun,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- i18n Translation ---\n");
        console.log(`Translated:      ${result.translated}`);
        console.log(`Unchanged:       ${result.unchanged}`);
        console.log(`Pending:         ${result.pending}`);
        console.log(`Review:          ${result.review}`);
        console.log(`Files Modified:  ${result.filesModified.length}`);
        if (result.filesModified.length > 0) {
          for (const f of result.filesModified) {
            console.log(`  - ${f}`);
          }
        }

        if (result.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of result.warnings) {
            console.log(`  - ${w}`);
          }
        }

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          for (const e of result.errors) {
            console.log(`  - ${e}`);
          }
        }

        console.log("\n-------------------------------------\n");

        if (result.errors.length > 0) {
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Translation failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("validate")
  .description("Validate i18n implementations across locale files and source code")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--locales <locales...>", "Locales to validate")
  .option("--namespaces <namespaces...>", "Namespaces to validate")
  .option("--check-source", "Scan source code for remaining unextracted strings", false)
  .option("--scope <scope...>", "Scope when check-source is active")
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        locales?: string[];
        namespaces?: string[];
        checkSource: boolean;
        scope?: string[];
        json: boolean;
      }
    ) => {
      try {
        const { validateI18n } = await import(
          "../core/validation/i18n-validator.js"
        );

        const result = await validateI18n({
          projectPath,
          locales: options.locales,
          namespaces: options.namespaces,
          checkSourceCode: options.checkSource,
          scope: options.scope,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- i18n Validation ---\n");
        console.log(`Valid:           ${result.valid ? "YES" : "NO"}`);
        console.log(`Errors:          ${result.errorCount}`);
        console.log(`Warnings:        ${result.warningCount}`);
        console.log(`Total Keys:      ${result.summary.totalKeys}`);
        console.log(`Locales:         [${result.summary.localesChecked.join(", ")}]`);
        console.log(`Namespaces:      [${result.summary.namespacesChecked.join(", ")}]`);

        if (result.issues.length > 0) {
          console.log("\nIssues:");
          for (const issue of result.issues) {
            console.log(
              `  [${issue.severity.toUpperCase()}] [${issue.type}] ${issue.file ? `${issue.file}: ` : ""}${issue.message}`
            );
          }
        }

        console.log("\n------------------------------------\n");

        if (!result.valid) {
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Validation failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("internationalize")
  .description("End-to-end automated internationalization pipeline")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("--scope <scope...>", "Target files or folders to internationalize")
  .option("--source-locale <locale>", "Source locale (e.g. 'en')")
  .option("--target-locales <locales...>", "Target locales (e.g. 'fr' 'es')")
  .option("--apply", "Apply changes to source and locale files (defaults to false / dry-run)", false)
  .option("--dry-run", "Explicitly run in dry-run mode (default)", false)
  .option("--translate", "Translate missing keys into target locales", false)
  .option("--create-backup", "Create .bak copies of original files", false)
  .option("--fail-on-warnings", "Fail execution if any warnings occur", false)
  .option("--include <patterns...>", "Glob patterns to include")
  .option("--exclude <patterns...>", "Glob patterns to exclude")
  .option("--namespaces <namespaces...>", "Limit to specific namespaces")
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        scope?: string[];
        sourceLocale?: string;
        targetLocales?: string[];
        apply: boolean;
        dryRun: boolean;
        translate: boolean;
        createBackup: boolean;
        failOnWarnings: boolean;
        include?: string[];
        exclude?: string[];
        namespaces?: string[];
        json: boolean;
      }
    ) => {
      try {
        const { internationalizeProject } = await import(
          "../core/orchestration/internationalize-service.js"
        );

        // Conservative defaults: if --apply is not set, or --dry-run is set, dryRun is true
        const isDryRun = options.dryRun || !options.apply;

        const result = await internationalizeProject({
          projectPath,
          scope: options.scope,
          sourceLocale: options.sourceLocale,
          targetLocales: options.targetLocales,
          dryRun: isDryRun,
          apply: options.apply,
          translate: options.translate,
          createBackup: options.createBackup,
          failOnWarnings: options.failOnWarnings,
          include: options.include,
          exclude: options.exclude,
          namespaces: options.namespaces,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- Automated Internationalization ---\n");
        console.log(`Status:                  ${result.status}`);
        console.log(`Success:                 ${result.success}`);
        console.log(`Framework:               ${result.project.framework || "unknown"}`);
        console.log(`i18n Library:            ${result.project.i18nLibrary || "none"}`);
        console.log(`Source Locale:           ${result.project.sourceLocale || "en"}`);
        console.log(`Target Locales:          [${(result.project.targetLocales || []).join(", ")}]`);
        console.log("\nScan Summary:");
        console.log(`  Candidates:            ${result.scan.candidates}`);
        console.log(`  User-facing:           ${result.scan.userFacing}`);
        console.log(`  Technical:             ${result.scan.technical}`);
        console.log(`  Review:                ${result.scan.review}`);
        console.log("\nPlan Summary:");
        console.log(`  Source Changes:        ${result.plan.changes}`);
        console.log(`  Review Items:          ${result.plan.reviewItems}`);
        console.log(`  Translation Entries:   ${result.plan.translationEntries}`);

        if (result.apply) {
          console.log("\nApplied Modifications:");
          console.log(`  Files Changed:         ${result.apply.filesChanged.length}`);
          console.log(`  Source Replacements:   ${result.apply.sourceChangesApplied}`);
          console.log(`  Locale Keys Created:   ${result.apply.translationEntriesCreated}`);
          for (const f of result.apply.filesChanged) {
            console.log(`    - ${f}`);
          }
        }

        if (result.translation) {
          console.log("\nTranslation Results:");
          console.log(`  Translated:            ${result.translation.translated}`);
          console.log(`  Unchanged:             ${result.translation.unchanged}`);
          console.log(`  Pending Translation:   ${result.translation.pending}`);
          console.log(`  Needs Review:          ${result.translation.review}`);
        }

        if (result.validation) {
          console.log("\nValidation:");
          console.log(`  Valid:                 ${result.validation.valid ? "YES" : "NO"}`);
          console.log(`  Errors:                ${result.validation.errorCount}`);
          console.log(`  Warnings:              ${result.validation.warningCount}`);
        }

        if (result.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of result.warnings) {
            console.log(`  - ${w}`);
          }
        }

        if (result.errors.length > 0) {
          console.log("\nErrors:");
          for (const e of result.errors) {
            console.log(`  - ${e}`);
          }
        }

        if (result.diff) {
          console.log("\nUnified Diff:");
          console.log(result.diff);
        }

        console.log("\n---------------------------------------------------\n");

        if (!result.success) {
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Internationalization failed:", error);
        }
        process.exit(1);
      }
    }
  );

program
  .command("types")
  .description("Generate TypeScript definition file (resources.d.ts) from source locale catalogs")
  .argument("[path]", "Path to project root (defaults to current directory)", ".")
  .option("-o, --output <path>", "Output file path (e.g. src/@types/resources.d.ts)")
  .option("--dry-run", "Preview generated TypeScript definitions without writing to disk", false)
  .option("--json", "Output results strictly as JSON", false)
  .action(
    async (
      projectPath: string,
      options: {
        output?: string;
        dryRun: boolean;
        json: boolean;
      }
    ) => {
      try {
        const { generateI18nTypes } = await import(
          "../core/typings/type-generator.js"
        );
        const result = await generateI18nTypes(projectPath, {
          outputPath: options.output,
          writeToDisk: !options.dryRun,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log("\n--- i18n TypeScript Type Generation ---\n");
        console.log(`Output:      ${result.outputPath}`);
        console.log(`Written:     ${!options.dryRun}`);
        console.log(`Namespaces:  [${result.namespaces.join(", ")}]`);

        if (options.dryRun) {
          console.log("\n--- Preview ---\n");
          console.log(result.content);
        }

        console.log("\n----------------------------------------\n");
      } catch (error: unknown) {
        if (error instanceof I18nMcpError) {
          console.error(`Error (${error.code}): ${error.message}`);
        } else {
          console.error("Type generation failed:", error);
        }
        process.exit(1);
      }
    }
  );

program.parse(process.argv);
