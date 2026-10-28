import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { importTranslations } from "../../core/exchange/translation-importer.js";
import type { TranslationExchangeFormat } from "../../models/exchange.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const importTranslationsSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  filePath: z
    .string()
    .optional()
    .describe("Path to the XLIFF (.xlf, .xliff) or TMX (.tmx) file to import."),
  content: z
    .string()
    .optional()
    .describe("Raw XLIFF or TMX XML content to import directly."),
  format: z
    .enum(["xliff-1.2", "xliff-2.0", "tmx-1.4"])
    .optional()
    .describe("Exchange standard format. If omitted, auto-detected from XML content."),
  targetLocales: z
    .array(z.string())
    .optional()
    .describe("Target locales to import into. If omitted, read from XML file headers."),
  overwrite: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to overwrite existing translations in project catalogs. Defaults to true."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, previews imported translations and unified diff without writing to disk."),
};

export function registerImportTranslationsTool(server: McpServer): void {
  server.tool(
    "import_translations",
    "Imports translated strings from standard XLIFF (1.2 / 2.0) or TMX 1.4 exchange files back into project translation catalogs (JSON or Flutter ARB), with unified diff support and collision safety.",
    importTranslationsSchema,
    async ({
      projectPath,
      filePath,
      content,
      format,
      targetLocales,
      overwrite,
      dryRun,
    }) => {
      logger.info(
        `Invoking import_translations (projectPath=${projectPath}, filePath=${filePath}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await importTranslations({
          projectPath: root,
          filePath,
          content,
          format: format as TranslationExchangeFormat | undefined,
          targetLocales,
          overwrite,
          dryRun,
        });

        const summaryLines = [
          `# Translation Import (${result.format.toUpperCase()})`,
          ``,
          `Target Locale: ${result.targetLocale || "detected"}`,
          `Units Processed: ${result.unitsProcessed}`,
          `Units Imported: ${result.unitsImported}`,
          `Units Skipped: ${result.unitsSkipped}`,
          `Mode: ${result.dryRun ? "DRY-RUN (Simulated)" : "APPLIED TO DISK"}`,
        ];

        if (result.filesModified.length > 0) {
          summaryLines.push(
            `Files Modified: ${result.filesModified.length}`,
            ...result.filesModified.map((f) => `- \`${f}\``)
          );
        }

        if (result.diff) {
          summaryLines.push(``, `## Unified Diff:`, `\`\`\`diff`, result.diff, `\`\`\``);
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
        logger.error("import_translations tool failed:", error);
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
                  code: "IMPORT_TRANSLATIONS_FAILED",
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
