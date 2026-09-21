import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createI18nMcpServer } from "../../src/mcp/server.js";
import type { InternationalizeResult } from "../../src/models/internationalize.js";
import type { TranslationServiceResult } from "../../src/models/translation.js";
import type { I18nValidationResult } from "../../src/models/validation.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function extractJson<T>(text: string): T {
  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch && jsonMatch[1]) {
    return JSON.parse(jsonMatch[1]) as T;
  }
  return JSON.parse(text) as T;
}

describe("MCP Integration - internationalize, translate_i18n, and validate_i18n", () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-mcp-orch-"));
    await copyDir(FIXTURE_PATH, sandboxDir);
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it("discovers internationalize, translate_i18n, and validate_i18n tools", async () => {
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

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);

    expect(toolNames).toContain("internationalize");
    expect(toolNames).toContain("translate_i18n");
    expect(toolNames).toContain("validate_i18n");

    await client.close();
    await server.close();
  });

  it("executes internationalize tool with conservative dry-run by default", async () => {
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
      name: "internationalize",
      arguments: {
        projectPath: sandboxDir,
        scope: ["src/features/auth"],
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = extractJson<InternationalizeResult>(
      (result.content[0] as { type: string; text: string }).text
    );

    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("PLAN_READY");
    expect(parsed.scan.userFacing).toBe(3);
    expect(parsed.plan.changes).toBe(3);
    expect(parsed.diff).toBeDefined();

    // Verify disk untouched
    const loginScreen = path.join(sandboxDir, "src/features/auth/LoginScreen.tsx");
    const content = await fs.readFile(loginScreen, "utf8");
    expect(content).toContain("Welcome back");

    await client.close();
    await server.close();
  });

  it("executes internationalize with apply=true, translate=true and verifies validation passes", async () => {
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
      name: "internationalize",
      arguments: {
        projectPath: sandboxDir,
        scope: ["src/features/auth"],
        apply: true,
        dryRun: false,
        translate: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = extractJson<InternationalizeResult>(
      (result.content[0] as { type: string; text: string }).text
    );

    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("APPLIED");
    expect(parsed.apply?.sourceChangesApplied).toBe(3);
    expect(parsed.translation?.translated).toBeGreaterThanOrEqual(1);
    expect(parsed.validation?.valid).toBe(true);

    // Call standalone validate_i18n on the migrated sandbox
    const valResult = await client.callTool({
      name: "validate_i18n",
      arguments: {
        projectPath: sandboxDir,
      },
    });

    expect(valResult.isError).toBeFalsy();
    const valParsed = extractJson<I18nValidationResult>(
      (valResult.content[0] as { type: string; text: string }).text
    );
    expect(valParsed.valid).toBe(true);
    expect(valParsed.errorCount).toBe(0);

    await client.close();
    await server.close();
  });

  it("calls standalone translate_i18n and validate_i18n tools successfully", async () => {
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

    // First validate clean fixture
    const valBefore = await client.callTool({
      name: "validate_i18n",
      arguments: {
        projectPath: sandboxDir,
      },
    });
    const valBeforeParsed = extractJson<I18nValidationResult>(
      (valBefore.content[0] as { type: string; text: string }).text
    );
    expect(valBeforeParsed.valid).toBe(true);

    // Add a new key in en
    const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    enAuth.NEW_TERM = "Log in";
    await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

    // Validate now shows missing translation error
    const valAfter = await client.callTool({
      name: "validate_i18n",
      arguments: {
        projectPath: sandboxDir,
      },
    });
    const valAfterParsed = extractJson<I18nValidationResult>(
      (valAfter.content[0] as { type: string; text: string }).text
    );
    expect(valAfterParsed.valid).toBe(false);
    expect(valAfterParsed.errorCount).toBe(1);

    // Run standalone translate_i18n
    const transResult = await client.callTool({
      name: "translate_i18n",
      arguments: {
        projectPath: sandboxDir,
        dryRun: false,
      },
    });
    const transParsed = extractJson<TranslationServiceResult>(
      (transResult.content[0] as { type: string; text: string }).text
    );
    expect(transParsed.translated).toBeGreaterThanOrEqual(1);

    // Validate now passes again!
    const valFinal = await client.callTool({
      name: "validate_i18n",
      arguments: {
        projectPath: sandboxDir,
      },
    });
    const valFinalParsed = extractJson<I18nValidationResult>(
      (valFinal.content[0] as { type: string; text: string }).text
    );
    expect(valFinalParsed.valid).toBe(true);

    await client.close();
    await server.close();
  });
});
