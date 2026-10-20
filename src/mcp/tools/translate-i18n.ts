import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { translateI18n } from "../../core/translation/translation-service.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const translateI18nSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source locale to translate from (e.g. 'en'). Defaults to detected source locale."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target locales to translate to (e.g. ['fr', 'es']). Defaults to detected target locales."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to translate. If omitted, translates all namespaces."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, calculates translations and reports results without writing files to disk."),
  providedTranslations: z
    .record(z.any())
    .optional()
    .describe(
      "Map of target locale to translations provided by the agent (e.g. { fr: { common: { save: 'Enregistrer' } } } or { fr: { 'common:save': 'Enregistrer' } } or { fr: { save: 'Enregistrer' } })."
    ),
};

export function registerTranslateI18nTool(server: McpServer): void {
  server.tool(
    "translate_i18n",
    "Translate missing keys across target locale files using built-in dictionaries and glossary without overwriting existing translations.",
    translateI18nSchema,
    async ({
      projectPath,
      sourceLocale,
      targetLocales,
      namespaces,
      dryRun,
      providedTranslations,
    }) => {
      logger.info(
        `Invoking translate_i18n (dryRun=${dryRun ?? false}, projectPath=${projectPath})`
      );
      try {
        const result = await translateI18n({
          projectPath,
          sourceLocale,
          targetLocales,
          namespaces,
          dryRun: dryRun ?? false,
          providedTranslations,
        });

        const summaryText = [
          `# Translation Service Result`,
          ``,
          `Status: ${result.errors.length === 0 ? "Completed" : "Completed with errors"}`,
          ``,
          `## Summary`,
          `- Translated: ${result.translated}`,
          `- Unchanged (already translated): ${result.unchanged}`,
          `- Pending: ${result.pending}`,
          `- Review: ${result.review}`,
          `- Files modified: ${result.filesModified.length}`,
          ...(result.filesModified.length > 0
            ? result.filesModified.map((f) => `  - ${f}`)
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
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: `${summaryText}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
            },
          ],
          isError: result.errors.length > 0,
        };
      } catch (error: unknown) {
        logger.error("translate_i18n tool failed:", error);
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
