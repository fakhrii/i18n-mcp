import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "../utils/logger.js";

export function createI18nMcpServer(): McpServer {
  const server = new McpServer({
    name: "i18n-mcp",
    version: "0.1.4",
  });

  registerAllTools(server);
  return server;
}

export async function startStdioServer(): Promise<void> {
  logger.info("Starting i18n MCP Server on stdio (React Native, React, Next.js, Flutter)...");
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
  logger.info("i18n MCP Server running and ready for requests.");
}

import { fileURLToPath } from "node:url";
import * as path from "node:path";

// Auto-start when executed directly
const currentFilePath = fileURLToPath(import.meta.url).toLowerCase();
const executedPath = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : "";

const isDirectExecution =
  executedPath.length > 0 &&
  (currentFilePath === executedPath ||
    executedPath.endsWith("server.js") ||
    executedPath.endsWith("server.ts") ||
    executedPath.endsWith("mcp/server.js") ||
    executedPath.endsWith("mcp\\server.js"));

if (isDirectExecution) {
  startStdioServer().catch((error) => {
    logger.error("Fatal error running MCP server:", error);
    process.exit(1);
  });
}
