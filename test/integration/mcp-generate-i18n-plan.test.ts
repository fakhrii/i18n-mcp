import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createI18nMcpServer } from "../../src/mcp/server.js";
import type { I18nPlan } from "../../src/models/plan.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

function extractPlanFromJson(text: string): I18nPlan {
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch && jsonMatch[1]) {
    return JSON.parse(jsonMatch[1]) as I18nPlan;
  }
  return JSON.parse(text) as I18nPlan;
}

describe("MCP Integration - generate_i18n_plan", () => {
  it("discovers generate_i18n_plan tool and generates plan for fixture project", async () => {
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

    // 1. Verify tool discovery
    const tools = await client.listTools();
    const planTool = tools.tools.find((t) => t.name === "generate_i18n_plan");
    expect(planTool).toBeDefined();
    expect(planTool?.description).toContain("i18n migration plan");

    // 2. Call tool on fixture project
    const result = await client.callTool({
      name: "generate_i18n_plan",
      arguments: {
        projectPath: FIXTURE_PATH,
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    expect(firstItem.type).toBe("text");
    expect(firstItem.text).toContain("# i18n Migration Plan");

    const plan = extractPlanFromJson(firstItem.text);

    expect(plan.version).toBe("1.0.0");
    expect(plan.project.framework).toBe("react-native");
    expect(plan.project.library).toBe("react-i18next");
    expect(plan.summary.userFacingCount).toBeGreaterThanOrEqual(4);
    expect(plan.translations.length).toBeGreaterThanOrEqual(4);
    expect(plan.sourceChanges.length).toBeGreaterThanOrEqual(4);

    await client.close();
    await server.close();
  });

  it("filters plan by scope", async () => {
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
      name: "generate_i18n_plan",
      arguments: {
        projectPath: FIXTURE_PATH,
        scope: "src/features/auth",
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    const plan = extractPlanFromJson(firstItem.text);

    expect(plan.summary.userFacingCount).toBe(3);
    for (const sc of plan.sourceChanges) {
      expect(sc.file).toContain("auth");
    }

    await client.close();
    await server.close();
  });

  it("communicates over stdio transport with the built MCP server", async () => {
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
      name: "generate_i18n_plan",
      arguments: {
        projectPath: FIXTURE_PATH,
        scope: "src/features/auth/LoginScreen.tsx",
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    const plan = extractPlanFromJson(firstItem.text);

    expect(plan.translations.length).toBe(3);
    const keys = plan.translations.map((t) => t.key);
    expect(keys).toContain("WELCOME_BACK");
    expect(keys).toContain("ENTER_YOUR_EMAIL");
    expect(keys).toContain("ENTER_YOUR_PASSWORD");

    await client.close();
  });
});
