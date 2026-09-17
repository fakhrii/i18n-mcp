import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createI18nMcpServer } from "../../src/mcp/server.js";
import type { ProjectAnalysis } from "../../src/models/project.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("MCP Integration - analyze_project", () => {
  it("successfully connects an MCP client, discovers analyze_project, and analyzes the fixture project", async () => {
    const server = createI18nMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    // 1. List tools
    const toolsResult = await client.listTools();
    const analyzeTool = toolsResult.tools.find((t) => t.name === "analyze_project");

    expect(analyzeTool).toBeDefined();
    expect(analyzeTool?.description).toContain("Analyze a React Native project");

    // 2. Call analyze_project with the fixture path
    const result = await client.callTool({
      name: "analyze_project",
      arguments: {
        projectPath: FIXTURE_PATH,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const firstItem = result.content[0] as { type: string; text: string };
    expect(firstItem.type).toBe("text");

    const analysis = JSON.parse(firstItem.text) as ProjectAnalysis;

    expect(analysis.framework).toBe("react-native");
    expect(analysis.language).toBe("typescript");
    expect(analysis.packageManager).toBe("yarn");
    expect(analysis.i18n.library).toBe("react-i18next");
    expect(analysis.i18n.localeDirectory).toBe("src/locales");
    expect(analysis.i18n.sourceLocale).toBe("en");
    expect(analysis.i18n.targetLocales).toContain("fr");
    expect(analysis.namespaces).toEqual(["auth", "common", "profile"]);
    expect(analysis.projectStructure.features).toEqual(["auth", "profile"]);
    expect(analysis.accessPatterns).toContain("useTranslation");

    // Clean up
    await client.close();
    await server.close();
  });

  it("handles non-existent path cleanly via MCP tool error response", async () => {
    const server = createI18nMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const result = await client.callTool({
      name: "analyze_project",
      arguments: {
        projectPath: path.join(FIXTURE_PATH, "invalid_dir_path"),
      },
    });

    expect(result.isError).toBe(true);
    const firstItem = result.content[0] as { type: string; text: string };
    const errData = JSON.parse(firstItem.text);
    expect(errData.error).toBe(true);
    expect(errData.code).toBe("PROJECT_NOT_FOUND");

    await client.close();
    await server.close();
  });

  it("successfully communicates over stdio transport with the built MCP server", async () => {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

    const serverScriptPath = path.resolve(__dirname, "../../dist/mcp/server.js");
    const transport = new StdioClientTransport({
      command: "node",
      args: [serverScriptPath],
    });

    const client = new Client(
      { name: "test-stdio-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: "analyze_project",
      arguments: {
        projectPath: FIXTURE_PATH,
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    const analysis = JSON.parse(firstItem.text) as ProjectAnalysis;

    expect(analysis.framework).toBe("react-native");
    expect(analysis.i18n.library).toBe("react-i18next");
    expect(analysis.namespaces).toContain("auth");

    await client.close();
  });
});

