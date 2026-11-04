import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { exportTranslations } from "../../core/exchange/translation-exporter.js";
import type { TranslationExchangeFormat } from "../../models/exchange.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const exportTranslationsSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  format: z
    .enum(["xliff-1.2", "xliff-2.0", "tmx-1.4"])
    .optional()
    .default("xliff-1.2")
    .describe("Exchange standard: 'xliff-1.2' (standard OASIS XLIFF), 'xliff-2.0' (modern XLIFF 2), or 'tmx-1.4' (LISA Translation Memory eXchange). Defaults to 'xliff-1.2'."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source language code (e.g. 'en'). Defaults to detected source locale."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target language codes to export (e.g. ['fr', 'de', 'es'])."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to limit export to."),
  outputPath: z
    .string()
    .optional()
    .describe("File or directory path to save exported exchange files. If omitted, returns output in content."),
  includeNotes: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include translator notes / ARB descriptions. Defaults to true."),
};

export function registerExportTranslationsTool(server: McpServer): void {
  server.tool(
    "export_translations",
    "Exports translation catalogs (JSON or Flutter ARB) into standard XLIFF (1.2 / 2.0) or TMX 1.4 exchange files for professional translation agencies and Translation Management Systems (Crowdin, Lokalise, Phrase, Smartling, Trados).",
    exportTranslationsSchema,
    async ({
      projectPath,
      format,
      sourceLocale,
      targetLocales,
      namespaces,
      outputPath,
      includeNotes,
    }) => {
      logger.info(
        `Invoking export_translations (projectPath=${projectPath}, format=${format}, outputPath=${outputPath})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await exportTranslations({
          projectPath: root,
          format: format as TranslationExchangeFormat,
          sourceLocale,
          targetLocales,
          namespaces,
          outputPath,
          includeNotes,
        });

        const summaryLines = [
          `# Translation Export (${result.format.toUpperCase()})`,
          ``,
          `Source Locale: ${result.sourceLocale}`,
          `Target Locales: ${result.targetLocales.join(", ")}`,
          `Total Units Exported: ${result.totalUnitsExported}`,
        ];

        if (result.filesExported.length > 0) {
          summaryLines.push(
            `Files Generated: ${result.filesExported.length}`,
            ...result.filesExported.map((f) => `- \`${f}\``)
          );
        }

        if (result.content && result.filesExported.length <= 1) {
          summaryLines.push(``, `## Export Preview:`, `\`\`\`xml`, result.content.slice(0, 4000), `\`\`\``);
          if (result.content.length > 4000) {
            summaryLines.push(`*(output truncated for preview; ${result.content.length} total bytes)*`);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: summaryLines.join("\n"),
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("export_translations tool failed:", error);
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
                  code: "EXPORT_TRANSLATIONS_FAILED",
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
