import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyI18nPlan } from "../../core/replacement/plan-applicator.js";
import type { I18nPlan } from "../../models/plan.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const applyI18nPlanSchema = {
  plan: z
    .any()
    .optional()
    .describe(
      "The full I18nPlan object produced by generate_i18n_plan. Either plan or planPath must be provided."
    ),
  planPath: z
    .string()
    .optional()
    .describe("Path to a JSON file containing an I18nPlan."),
  projectPath: z
    .string()
    .optional()
    .describe(
      "Optional project root path. If omitted, uses plan.project.root or current working directory."
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, calculates changes, validates everything, and returns diffs without modifying files."
    ),
  createBackup: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, creates .bak copies of original files before writing changes."),
  failOnWarnings: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, aborts execution before writing if any warnings are encountered."),
};

export function registerApplyI18nPlanTool(server: McpServer): void {
  server.tool(
    "apply_i18n_plan",
    "Safely and atomically apply an approved i18n migration plan to the project (React Native, React, Next.js, Flutter). Performs source replacements, hook/import insertions, and locale JSON updates with stale plan protection and optional dry-run.",
    applyI18nPlanSchema,
    async ({
      plan,
      planPath,
      projectPath,
      dryRun,
      createBackup,
      failOnWarnings,
    }) => {
      logger.info(
        `Invoking apply_i18n_plan (dryRun=${dryRun ?? false}, createBackup=${createBackup ?? false})`
      );
      try {
        const result = await applyI18nPlan({
          plan: plan as I18nPlan | undefined,
          planPath,
          projectPath,
          dryRun: dryRun ?? false,
          createBackup: createBackup ?? false,
          failOnWarnings: failOnWarnings ?? false,
        });

        const statusLine = result.success
          ? result.dryRun
            ? "Dry-run completed successfully (no files modified)."
            : "i18n plan applied successfully."
          : "Failed to apply i18n plan.";

        const summaryText = [
          `# Plan Application Result`,
          ``,
          `Status: ${statusLine}`,
          ``,
          `## Summary`,
          `- Dry-run: ${result.dryRun}`,
          `- Files modified: ${result.filesChanged.length}`,
          `- Files skipped: ${result.filesSkipped.length}`,
          `- Source replacements applied: ${result.sourceChangesApplied}`,
          `- Locale keys created: ${result.translationEntriesCreated}`,
          `- Target translations pending: ${result.translationsPending}`,
          ...(result.warnings.length > 0
            ? [
                ``,
                `## Warnings (${result.warnings.length})`,
                ...result.warnings.map(
                  (w) => `- [${w.code}] ${w.file ? `${w.file}: ` : ""}${w.message}`
                ),
              ]
            : []),
          ...(result.errors.length > 0
            ? [
                ``,
                `## Errors (${result.errors.length})`,
                ...result.errors.map(
                  (e) => `- [${e.code}] ${e.file ? `${e.file}: ` : ""}${e.message}`
                ),
              ]
            : []),
          ...(result.diff
            ? [
                ``,
                `## Changes Diff`,
                `\`\`\`diff`,
                result.diff,
                `\`\`\``,
              ]
            : []),
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: `${summaryText}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
            },
          ],
          isError: !result.success,
        };
      } catch (error: unknown) {
        logger.error("apply_i18n_plan tool failed:", error);
        if (error instanceof I18nMcpError) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(error.toJSON(), null, 2),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: true,
                  code: "UNKNOWN_ERROR",
                  message: error instanceof Error ? error.message : String(error),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
