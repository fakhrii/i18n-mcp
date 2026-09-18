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

program.parse(process.argv);

