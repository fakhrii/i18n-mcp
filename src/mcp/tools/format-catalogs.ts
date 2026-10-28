import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatCatalogs } from "../../core/format/catalog-formatter.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const formatCatalogsSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  locales: z
    .array(z.string())
    .optional()
    .describe("Optional list of locales to format. Defaults to all project locales."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to format."),
  sortOrder: z
    .enum(["alphabetical", "align-with-source"])
    .optional()
    .default("alphabetical")
    .describe("Sort order: 'alphabetical' (natural A-Z sort across all levels) or 'align-with-source' (orders target locale keys to match the source locale)."),
  indent: z
    .number()
    .optional()
    .default(2)
    .describe("Indentation space count (default 2)."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, previews changes via unified diffs without modifying files. If false, writes formatted files to disk."),
};

export function registerFormatCatalogsTool(server: McpServer): void {
  server.tool(
    "format_catalogs",
    "Cleans, sorts, and formats translation catalogs (JSON and ARB) alphabetically or aligned with source locale key ordering, eliminating merge conflicts and inconsistent formatting.",
    formatCatalogsSchema,
    async ({ projectPath, locales, namespaces, sortOrder, indent, dryRun }) => {
      logger.info(
        `Invoking format_catalogs (projectPath=${projectPath}, sortOrder=${sortOrder}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await formatCatalogs({
          projectPath: root,
          locales,
          namespaces,
          sortOrder,
          indent,
          dryRun,
        });

        const summaryLines = [
          `# i18n Catalog Formatting & Sorting`,
          ``,
          `Status: SUCCESS`,
          `Mode: ${result.dryRun ? "DRY-RUN (Simulated)" : "APPLIED TO DISK"}`,
          `Files Formatted: ${result.filesFormatted.length}`,
          `Files Up-to-Date: ${result.filesSkipped.length}`,
          `Keys Processed: ${result.totalKeysSorted}`,
        ];

        if (result.filesFormatted.length > 0) {
          summaryLines.push(``, `## Formatted Catalogs:`);
          for (const f of result.filesFormatted) {
            summaryLines.push(`- \`${f}\``);
          }
        }

        if (result.diff) {
          summaryLines.push(``, `## Unified Diff Preview:`, `\`\`\`diff`, result.diff, `\`\`\``);
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
        logger.error("format_catalogs tool failed:", error);
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
                  code: "CATALOG_FORMAT_FAILED",
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
