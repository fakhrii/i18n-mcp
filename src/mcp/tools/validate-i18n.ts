import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateI18n } from "../../core/validation/i18n-validator.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const validateI18nSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  locales: z
    .array(z.string())
    .optional()
    .describe("Optional list of locales to validate against the source locale."),
  namespaces: z
    .array(z.string())
    .optional()
    .describe("Optional list of namespaces to validate."),
  checkSourceCode: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, also scans source files for remaining unextracted hardcoded strings."),
  scope: z
    .array(z.string())
    .optional()
    .describe("Optional specific directory or file scope when checkSourceCode is enabled."),
};

export function registerValidateI18nTool(server: McpServer): void {
  server.tool(
    "validate_i18n",
    "Validate i18n implementation for missing translations, interpolation variable mismatches, orphan keys, and malformed JSON.",
    validateI18nSchema,
    async ({
      projectPath,
      locales,
      namespaces,
      checkSourceCode,
      scope,
    }) => {
      logger.info(`Invoking validate_i18n (projectPath=${projectPath})`);
      try {
        const result = await validateI18n({
          projectPath,
          locales,
          namespaces,
          checkSourceCode: checkSourceCode ?? false,
          scope,
        });

        const statusLine = result.valid
          ? "Validation passed successfully."
          : `Validation failed with ${result.errorCount} error(s).`;

        const summaryText = [
          `# i18n Validation Result`,
          ``,
          `Status: ${statusLine}`,
          ``,
          `## Summary`,
          `- Valid: ${result.valid}`,
          `- Errors: ${result.errorCount}`,
          `- Warnings: ${result.warningCount}`,
          `- Total keys checked: ${result.summary.totalKeys}`,
          `- Locales checked: [${result.summary.localesChecked.join(", ")}]`,
          `- Namespaces checked: [${result.summary.namespacesChecked.join(", ")}]`,
          ...(result.issues.length > 0
            ? [
                ``,
                `## Issues (${result.issues.length})`,
                ...result.issues.map(
                  (i) =>
                    `- [${i.severity.toUpperCase()}] [${i.type}] ${i.file ? `${i.file}: ` : ""}${i.message}`
                ),
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
          isError: !result.valid,
        };
      } catch (error: unknown) {
        logger.error("validate_i18n tool failed:", error);
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
