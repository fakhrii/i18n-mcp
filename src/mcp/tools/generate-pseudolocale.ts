import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generatePseudolocale } from "../../core/pseudolocale/pseudolocalizer.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const generatePseudolocaleSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  sourceLocale: z
    .string()
    .optional()
    .describe("Source locale to read from (e.g. 'en'). Defaults to project source locale."),
  targetLocale: z
    .string()
    .optional()
    .describe("Target pseudo-locale name (e.g. 'qps-ploc', 'en-XA', or 'qps-plocm' for bidi). Defaults to 'qps-ploc'."),
  strategy: z
    .enum(["accented", "bidi", "expansion", "all"])
    .optional()
    .default("all")
    .describe("Pseudo-localization strategy: 'accented' (diacritics), 'bidi' (RTL mirroring), 'expansion' (text elongation), or 'all' (default)."),
  expansionRatio: z
    .number()
    .optional()
    .default(0.35)
    .describe("Length expansion multiplier (default 0.35, i.e., +35% longer text)."),
  delimiter: z
    .enum(["brackets", "exclamation", "none"])
    .optional()
    .default("exclamation")
    .describe("Surrounding delimiters: 'exclamation' ([!! ... !!]), 'brackets' ([...]), or 'none'."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to limit pseudo-localization to."),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, simulates generation and returns diffs without modifying files. If false, writes catalogs to disk."),
};

export function registerGeneratePseudolocaleTool(server: McpServer): void {
  server.tool(
    "generate_pseudolocale",
    "Generates pseudo-localized catalogs (e.g. qps-ploc, en-XA) from the source locale for stress-testing UI layouts, text expansion (+35%), font glyph support, and spotting unextracted strings.",
    generatePseudolocaleSchema,
    async ({
      projectPath,
      sourceLocale,
      targetLocale,
      strategy,
      expansionRatio,
      delimiter,
      namespaces,
      dryRun,
    }) => {
      logger.info(
        `Invoking generate_pseudolocale (projectPath=${projectPath}, targetLocale=${targetLocale}, strategy=${strategy}, dryRun=${dryRun})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await generatePseudolocale({
          projectPath: root,
          sourceLocale,
          targetLocale,
          strategy,
          expansionRatio,
          delimiter,
          namespaces,
          dryRun,
        });

        const summaryLines = [
          `# Pseudo-Localization Generation`,
          ``,
          `Status: SUCCESS`,
          `Mode: ${result.dryRun ? "DRY-RUN (Simulated)" : "WRITTEN TO DISK"}`,
          `Source Locale: ${result.sourceLocale}`,
          `Target Pseudo-Locale: ${result.targetLocale}`,
          `Keys Transformed: ${result.keysTransformed}`,
          `Files Modified: ${result.filesModified.length}`,
        ];

        if (result.filesModified.length > 0) {
          summaryLines.push(``, `## Catalogs:`);
          for (const f of result.filesModified) {
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
        logger.error("generate_pseudolocale tool failed:", error);
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
                  code: "PSEUDOLOCALE_GENERATION_FAILED",
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
