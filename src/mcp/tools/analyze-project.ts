import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeProject } from "../../core/discovery/project-analyzer.js";
import { I18nMcpError } from "../../models/errors.js";
import { logger } from "../../utils/logger.js";

export const analyzeProjectSchema = {
  projectPath: z
    .string()
    .optional()
    .describe(
      "Optional path to the project root directory. Defaults to the current working directory."
    ),
};

export function registerAnalyzeProjectTool(server: McpServer): void {
  server.tool(
    "analyze_project",
    "Analyze a React Native project without modifying anything. Returns framework, language, package manager, detected i18n library, configuration, locale directory, source and target locales, existing namespaces, project structure, and configuration warnings.",
    analyzeProjectSchema,
    async ({ projectPath }) => {
      logger.info(`Invoking analyze_project tool for path: ${projectPath || "."}`);
      try {
        const analysis = await analyzeProject(projectPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      } catch (error: unknown) {
        logger.error("analyze_project tool failed:", error);
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
