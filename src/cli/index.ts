#!/usr/bin/env node

import { Command } from "commander";
import { analyzeProject } from "../core/discovery/project-analyzer.js";
import { I18nMcpError } from "../models/errors.js";

const program = new Command();

program
  .name("i18n-mcp")
  .description("CLI and developer tool for React Native automatic internationalization")
  .version("0.1.0");

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

      console.log("\n--- React Native i18n Analysis ---\n");
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

        console.log("\n--- React Native i18n Migration Plan ---\n");
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

        console.log("\n--- React Native i18n Plan Application ---\n");
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

program.parse(process.argv);

