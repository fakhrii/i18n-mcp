import { describe, it, expect } from "vitest";
import { generateI18nTypes } from "../../src/core/typings/type-generator.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("Phase P3: TypeScript Typings Generation (resources.d.ts)", () => {
  it("generates strict resources.d.ts module augmentation for multi-namespace projects", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "type-gen-multi-"));
    const srcDir = path.join(tempDir, "src");
    const localesDir = path.join(srcDir, "locales", "en");
    await fs.mkdir(localesDir, { recursive: true });

    // Create fixture locale files
    await fs.writeFile(path.join(localesDir, "auth.json"), JSON.stringify({ LOGIN: "Log in" }));
    await fs.writeFile(path.join(localesDir, "common.json"), JSON.stringify({ SAVE: "Save" }));

    // Create package.json
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-app", dependencies: { "react-i18next": "^13.0.0" } })
    );

    const result = await generateI18nTypes(tempDir, { writeToDisk: true });

    expect(result.outputPath).toBe("src/@types/resources.d.ts");
    expect(result.namespaces).toEqual(["auth", "common"]);
    expect(result.content).toContain('import type auth from "../locales/en/auth.json";');
    expect(result.content).toContain('import type common from "../locales/en/common.json";');
    expect(result.content).toContain('"auth": typeof auth;');
    expect(result.content).toContain('"common": typeof common;');
    expect(result.content).toContain('defaultNS: "common";');
    expect(result.content).toContain('declare module "i18next"');

    // Verify written to disk
    const diskContent = await fs.readFile(path.join(tempDir, result.outputPath), "utf8");
    expect(diskContent).toBe(result.content);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("generates strict resources.d.ts module augmentation for single-file projects", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "type-gen-single-"));
    const srcDir = path.join(tempDir, "src");
    const localesDir = path.join(srcDir, "locales");
    await fs.mkdir(localesDir, { recursive: true });

    await fs.writeFile(path.join(localesDir, "en.json"), JSON.stringify({ TITLE: "App Title" }));
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-single-app", dependencies: { "i18next": "^23.0.0" } })
    );

    const result = await generateI18nTypes(tempDir, { writeToDisk: false });

    expect(result.namespaces).toEqual(["translation"]);
    expect(result.content).toContain('import type en from "../locales/en.json";');
    expect(result.content).toContain('translation: typeof en;');
    expect(result.content).toContain('declare module "i18next"');

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("exposes generate_i18n_types via MCP server and executes correctly", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createI18nMcpServer } = await import("../../src/mcp/server.js");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "type-gen-mcp-"));
    const srcDir = path.join(tempDir, "src");
    const localesDir = path.join(srcDir, "locales", "en");
    await fs.mkdir(localesDir, { recursive: true });
    await fs.writeFile(path.join(localesDir, "common.json"), JSON.stringify({ HELLO: "Hello" }));
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test-mcp-app", dependencies: { "react-i18next": "^13.0.0" } })
    );

    const server = createI18nMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const toolsResult = await client.listTools();
    const tool = toolsResult.tools.find((t) => t.name === "generate_i18n_types");
    expect(tool).toBeDefined();

    const callResult = await client.callTool({
      name: "generate_i18n_types",
      arguments: {
        projectPath: tempDir,
        writeToDisk: true,
      },
    });

    expect(callResult.isError).toBeFalsy();
    const text = (callResult.content[0] as { type: string; text: string }).text;
    expect(text).toContain("Status: SUCCESS");
    expect(text).toContain("src/@types/resources.d.ts");

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
