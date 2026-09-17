import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "../utils/logger.js";

export function createI18nMcpServer(): McpServer {
  const server = new McpServer({
    name: "react-native-i18n-mcp",
    version: "0.1.0",
  });

  registerAllTools(server);
  return server;
}

export async function startStdioServer(): Promise<void> {
  logger.info("Starting React Native i18n MCP Server on stdio...");
  const server = createI18nMcpServer();
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down MCP server...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down MCP server...");
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
  logger.info("React Native i18n MCP Server running and ready for requests.");
}

import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Auto-start when executed directly
const isDirectExecution =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    process.argv[1].endsWith("mcp/server.js") ||
    process.argv[1].endsWith("mcp\\server.js"));

if (isDirectExecution) {
  startStdioServer().catch((error) => {
    logger.error("Fatal error running MCP server:", error);
    process.exit(1);
  });
}
