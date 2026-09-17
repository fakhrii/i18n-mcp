import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalyzeProjectTool } from "./analyze-project.js";

export function registerAllTools(server: McpServer): void {
  registerAnalyzeProjectTool(server);
}

export * from "./analyze-project.js";
