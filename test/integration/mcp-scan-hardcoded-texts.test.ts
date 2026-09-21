import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createI18nMcpServer } from "../../src/mcp/server.js";
import type { ScanResult } from "../../src/models/scanner.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("MCP Integration - scan_hardcoded_texts", () => {
  it("discovers scan_hardcoded_texts tool and scans fixture project", async () => {
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

    // 1. Check tool list
    const tools = await client.listTools();
    const scanTool = tools.tools.find((t) => t.name === "scan_hardcoded_texts");
    expect(scanTool).toBeDefined();
    expect(scanTool?.description).toContain("Scan a React Native project");

    // 2. Call tool on fixture project
    const result = await client.callTool({
      name: "scan_hardcoded_texts",
      arguments: {
        projectPath: FIXTURE_PATH,
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    expect(firstItem.type).toBe("text");

    const scanResult = JSON.parse(firstItem.text) as ScanResult;

    expect(scanResult.total).toBeGreaterThanOrEqual(4);
    expect(scanResult.userFacingCount).toBeGreaterThanOrEqual(4);

    const texts = scanResult.items.map((i) => i.text);
    expect(texts).toContain("Welcome back");
    expect(texts).toContain("Enter your email");
    expect(texts).toContain("Enter your password");
    expect(texts).toContain("Manage your personal settings");

    // Ensure already translated strings were NOT returned as hardcoded
    expect(texts).not.toContain("Log in");
    expect(texts).not.toContain("LOGIN");
    expect(texts).not.toContain("FORGOT_PASSWORD");
    expect(texts).not.toContain("TITLE");

    // Check item details
    const welcomeItem = scanResult.items.find((i) => i.text === "Welcome back");
    expect(welcomeItem?.type).toBe("JSX_TEXT");
    expect(welcomeItem?.classification).toBe("UI_TEXT");
    expect(welcomeItem?.suggestedKey).toBe("WELCOME_BACK");
    expect(welcomeItem?.suggestedNamespace).toBe("auth");
    expect(welcomeItem?.confidenceLevel).toBe("HIGH");

    const emailPlaceholder = scanResult.items.find(
      (i) => i.text === "Enter your email"
    );
    expect(emailPlaceholder?.type).toBe("JSX_ATTRIBUTE");
    expect(emailPlaceholder?.propName).toBe("placeholder");
    expect(emailPlaceholder?.classification).toBe("PLACEHOLDER");
    expect(emailPlaceholder?.suggestedNamespace).toBe("auth");

    await client.close();
    await server.close();
  });

  it("filters scan results by scope", async () => {
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
      name: "scan_hardcoded_texts",
      arguments: {
        projectPath: FIXTURE_PATH,
        scope: "src/features/auth",
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    const scanResult = JSON.parse(firstItem.text) as ScanResult;

    const files = Array.from(new Set(scanResult.items.map((i) => i.file)));
    expect(files).toEqual(["src/features/auth/LoginScreen.tsx"]);

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
      name: "scan_hardcoded_texts",
      arguments: {
        projectPath: FIXTURE_PATH,
        scope: "src/features/auth/LoginScreen.tsx",
      },
    });

    expect(result.isError).toBeFalsy();
    const firstItem = result.content[0] as { type: string; text: string };
    const scanResult = JSON.parse(firstItem.text) as ScanResult;

    expect(scanResult.items.length).toBe(3); // "Welcome back", "Enter your email", "Enter your password"
    expect(scanResult.items.map((i) => i.text)).toContain("Welcome back");

    await client.close();
  });
});
