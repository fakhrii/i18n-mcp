import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { internationalizeProject } from "../../core/orchestration/internationalize-service.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const internationalizeSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  scope: z
    .array(z.string())
    .optional()
    .describe("Optional target directories or files to internationalize (e.g. ['src/features/auth'])."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source locale (e.g. 'en'). Defaults to detected project source locale."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target locales to internationalize and translate to (e.g. ['fr', 'es'])."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default), simulates execution, generates plan, and shows diff without modifying files."),
  apply: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true and dryRun is false, applies source code and locale file modifications."),
  translate: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true and apply is true, translates missing target locale entries using dictionary and glossary."),
  createBackup: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, creates .bak backup files before modifying any file on disk."),
  failOnWarnings: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, halts and fails if any warning is encountered."),
  include: z
    .array(z.string())
    .optional()
    .describe("Glob patterns of files to include."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Glob patterns of files to exclude."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to limit planning and translation to."),
  candidateDecisions: z
    .record(z.boolean())
    .optional()
    .describe(
      "Optional map of candidate ID (or text) to boolean decision (true = include as user-facing, false = skip as technical) for resolving ambiguous strings."
    ),
  structure: z
    .enum(["namespaces", "nested", "flat"])
    .optional()
    .describe(
      "Optional i18n structure type override ('namespaces', 'nested', or 'flat'). Auto-detected by default."
    ),
  providedTranslations: z
    .record(z.any())
    .optional()
    .describe(
      "Optional map of agent-provided translations for target locales (e.g. { fr: { common: { save: 'Enregistrer' } } })."
    ),
};

export function registerInternationalizeTool(server: McpServer): void {
  server.tool(
    "internationalize",
    "End-to-end orchestration tool for i18n migration across React Native, React (web), Next.js, and Flutter projects. Runs analyze -> scan -> plan -> apply -> translate -> validate with conservative defaults and complete structured reporting.",
    internationalizeSchema,
    async ({
      projectPath,
      scope,
      sourceLocale,
      targetLocales,
      dryRun,
      apply,
      translate,
      createBackup,
      failOnWarnings,
      include,
      exclude,
      namespaces,
      candidateDecisions,
      structure,
      providedTranslations,
    }) => {
      logger.info(
        `Invoking internationalize tool (dryRun=${dryRun ?? true}, apply=${apply ?? false}, translate=${translate ?? false})`
      );
      try {
        const result = await internationalizeProject({
          projectPath,
          scope,
          sourceLocale,
          targetLocales,
          dryRun: dryRun ?? true,
          apply: apply ?? false,
          translate: translate ?? false,
          createBackup: createBackup ?? false,
          failOnWarnings: failOnWarnings ?? false,
          include,
          exclude,
          namespaces,
          candidateDecisions,
          structure,
          providedTranslations,
        });

        const summaryText = [
          `# Internationalization Workflow Result`,
          ``,
          `Status: **${result.status}**`,
          `Success: ${result.success}`,
          ``,
          `## Project`,
          `- Framework: ${result.project.framework || "unknown"}`,
          `- i18n Library: ${result.project.i18nLibrary || "none"}`,
          `- Source Locale: ${result.project.sourceLocale || "en"}`,
          `- Target Locales: [${(result.project.targetLocales || []).join(", ")}]`,
          `- Locale Directory: ${result.project.localeDirectory || "none"}`,
          ``,
          `## Scan Summary`,
          `- Total candidates: ${result.scan.candidates}`,
          `- User-facing detected: ${result.scan.userFacing}`,
          `- Technical strings ignored: ${result.scan.technical}`,
          `- Ambiguous/Review: ${result.scan.review}`,
          ``,
          `## Plan Summary`,
          `- Source code replacements: ${result.plan.changes}`,
          `- Items requiring human review: ${result.plan.reviewItems}`,
          `- Translation entries: ${result.plan.translationEntries}`,
          ...(result.apply
            ? [
                ``,
                `## Applied Modifications`,
                `- Files changed: ${result.apply.filesChanged.length}`,
                ...result.apply.filesChanged.map((f) => `  - ${f}`),
                `- Source changes applied: ${result.apply.sourceChangesApplied}`,
                `- Locale entries created: ${result.apply.translationEntriesCreated}`,
              ]
            : []),
          ...(result.translation
            ? [
                ``,
                `## Translation Results`,
                `- Translated: ${result.translation.translated}`,
                `- Unchanged: ${result.translation.unchanged}`,
                `- Pending human translation: ${result.translation.pending}`,
                `- Low-confidence review: ${result.translation.review}`,
              ]
            : []),
          ...(result.validation
            ? [
                ``,
                `## Validation`,
                `- Valid: ${result.validation.valid}`,
                `- Errors: ${result.validation.errorCount}`,
                `- Warnings: ${result.validation.warningCount}`,
              ]
            : []),
          ...(result.warnings.length > 0
            ? [
                ``,
                `## Warnings (${result.warnings.length})`,
                ...result.warnings.map((w) => `- ${w}`),
              ]
            : []),
          ...(result.errors.length > 0
            ? [
                ``,
                `## Errors (${result.errors.length})`,
                ...result.errors.map((e) => `- ${e}`),
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
        logger.error("internationalize tool failed:", error);
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
