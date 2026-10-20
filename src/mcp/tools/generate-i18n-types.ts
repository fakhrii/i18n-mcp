import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateI18nTypes } from "../../core/typings/type-generator.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const generateI18nTypesSchema = {
  projectPath: z
    .string()
    .optional()
    .describe("Optional project root directory. Defaults to current working directory."),
  outputPath: z
    .string()
    .optional()
    .describe(
      "Optional output path relative to project root (e.g. 'src/@types/resources.d.ts'). Defaults to standard types directory."
    ),
  writeToDisk: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default), writes the resources.d.ts file to disk. If false, returns content only."),
};

export function registerGenerateI18nTypesTool(server: McpServer): void {
  server.tool(
    "generate_i18n_types",
    "Generates TypeScript definitions (resources.d.ts) from the project's source locale catalogs, providing full autocomplete and compile-time key validation for i18n translation functions.",
    generateI18nTypesSchema,
    async ({ projectPath, outputPath, writeToDisk }) => {
      logger.info(
        `Invoking generate_i18n_types (projectPath=${projectPath}, outputPath=${outputPath})`
      );
      try {
        const root = projectPath || process.cwd();
        const result = await generateI18nTypes(root, {
          outputPath,
          writeToDisk: writeToDisk ?? true,
        });

        const summaryText = [
          `# i18n TypeScript Type Definition Generation`,
          ``,
          `Status: SUCCESS`,
          `Output file: ${result.outputPath}`,
          `Namespaces typed: [${result.namespaces.join(", ")}]`,
          `Written to disk: ${writeToDisk ?? true}`,
          ``,
          `## Generated Definition Preview:`,
          `\`\`\`typescript`,
          result.content,
          `\`\`\``,
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text: summaryText,
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("generate_i18n_types tool failed:", error);
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
                  code: "TYPE_GENERATION_FAILED",
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
