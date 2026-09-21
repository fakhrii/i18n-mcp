import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scanHardcodedTexts } from "../../core/scanner/scanner.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const scanHardcodedTextsSchema = {
  projectPath: z
    .string()
    .optional()
    .describe(
      "Optional path to the project root directory. Defaults to the current working directory."
    ),
  scope: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Optional scope: file path, directory path, glob pattern, or an array of them to limit scanning."
    ),
  include: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns to include for scanning."),
  exclude: z
    .array(z.string())
    .optional()
    .describe("Optional glob patterns to exclude from scanning."),
  onlyUserFacing: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to return only user-facing strings (default: true). Set to false to include technical strings."
    ),
  minConfidence: z
    .number()
    .optional()
    .default(0.0)
    .describe("Minimum confidence score threshold (0.0 to 1.0) for returned items."),
};

export function registerScanHardcodedTextsTool(server: McpServer): void {
  server.tool(
    "scan_hardcoded_texts",
    "Scan a React Native project or requested scope for hardcoded strings using AST analysis. Returns detected strings with source locations, AST context, classification, confidence score, suggested key and namespace, without modifying any files.",
    scanHardcodedTextsSchema,
    async ({
      projectPath,
      scope,
      include,
      exclude,
      onlyUserFacing,
      minConfidence,
    }) => {
      logger.info(`Invoking scan_hardcoded_texts for path: ${projectPath || "."}`);
      try {
        const result = await scanHardcodedTexts(projectPath, {
          scope,
          include,
          exclude,
          onlyUserFacing: onlyUserFacing ?? true,
          minConfidence: minConfidence ?? 0.0,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("scan_hardcoded_texts tool failed:", error);
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
