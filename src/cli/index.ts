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

program.parse(process.argv);
