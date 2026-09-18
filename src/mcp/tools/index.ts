import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalyzeProjectTool } from "./analyze-project.js";
import { registerScanHardcodedTextsTool } from "./scan-hardcoded-texts.js";
import { registerGenerateI18nPlanTool } from "./generate-i18n-plan.js";

export function registerAllTools(server: McpServer): void {
  registerAnalyzeProjectTool(server);
  registerScanHardcodedTextsTool(server);
  registerGenerateI18nPlanTool(server);
}

export * from "./analyze-project.js";
export * from "./scan-hardcoded-texts.js";
export * from "./generate-i18n-plan.js";
