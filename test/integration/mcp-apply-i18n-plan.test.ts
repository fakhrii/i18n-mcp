import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createI18nMcpServer } from "../../src/mcp/server.js";
import type { I18nPlan } from "../../src/models/plan.js";
import type { ApplyI18nPlanResult } from "../../src/models/replacement.js";
import type { ScanResult } from "../../src/models/scanner.js";

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

describe("MCP Integration - apply_i18n_plan", () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-mcp-sandbox-"));
    await copyDir(FIXTURE_PATH, sandboxDir);
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it("discovers apply_i18n_plan tool, runs dry-run, applies plan, and verifies 0 remaining strings", async () => {
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

    // 1. Check tool discovery
    const tools = await client.listTools();
    const applyTool = tools.tools.find((t) => t.name === "apply_i18n_plan");
    expect(applyTool).toBeDefined();
    expect(applyTool?.description).toContain("apply an approved i18n migration plan");

    // 2. Generate plan for sandbox
    const planResult = await client.callTool({
      name: "generate_i18n_plan",
      arguments: {
        projectPath: sandboxDir,
        scope: "src/features/auth",
      },
    });
    const plan = extractJson<I18nPlan>(
      (planResult.content[0] as { type: string; text: string }).text
    );
    expect(plan.translations.length).toBe(3);

    // 3. Call apply_i18n_plan with dryRun=true
    const dryRunResult = await client.callTool({
      name: "apply_i18n_plan",
      arguments: {
        plan,
        projectPath: sandboxDir,
        dryRun: true,
      },
    });

    expect(dryRunResult.isError).toBeFalsy();
    const dryRunParsed = extractJson<ApplyI18nPlanResult>(
      (dryRunResult.content[0] as { type: string; text: string }).text
    );
    expect(dryRunParsed.success).toBe(true);
    expect(dryRunParsed.dryRun).toBe(true);
    expect(dryRunParsed.diff).toBeDefined();

    // Verify sandbox file untouched in dry-run
    const screenPath = path.join(sandboxDir, "src/features/auth/LoginScreen.tsx");
    let screenContent = await fs.readFile(screenPath, "utf8");
    expect(screenContent).toContain("Welcome back");

    // 4. Call apply_i18n_plan with dryRun=false
    const applyResult = await client.callTool({
      name: "apply_i18n_plan",
      arguments: {
        plan,
        projectPath: sandboxDir,
        dryRun: false,
      },
    });

    expect(applyResult.isError).toBeFalsy();
    const applyParsed = extractJson<ApplyI18nPlanResult>(
      (applyResult.content[0] as { type: string; text: string }).text
    );
    expect(applyParsed.success).toBe(true);
    expect(applyParsed.dryRun).toBe(false);
    expect(applyParsed.sourceChangesApplied).toBe(3);
    expect(applyParsed.translationEntriesCreated).toBe(3);

    // 5. Verify file on disk was modified with translations
    screenContent = await fs.readFile(screenPath, "utf8");
    expect(screenContent).toContain('{t("WELCOME_BACK")}');
    expect(screenContent).toContain('placeholder={t("ENTER_YOUR_EMAIL")}');
    expect(screenContent).toContain('placeholder={t("ENTER_YOUR_PASSWORD")}');

    // Verify locale JSON file updated
    const authJsonPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const authJson = JSON.parse(await fs.readFile(authJsonPath, "utf8"));
    expect(authJson.WELCOME_BACK).toBe("Welcome back");
    expect(authJson.ENTER_YOUR_EMAIL).toBe("Enter your email");
    expect(authJson.ENTER_YOUR_PASSWORD).toBe("Enter your password");

    // 6. Rescan sandbox auth feature: must report 0 hardcoded strings remaining!
    const rescanResult = await client.callTool({
      name: "scan_hardcoded_texts",
      arguments: {
        projectPath: sandboxDir,
        scope: "src/features/auth",
      },
    });
    const rescan = extractJson<ScanResult>(
      (rescanResult.content[0] as { type: string; text: string }).text
    );
    expect(rescan.userFacingCount).toBe(0);

    // 7. Stale Plan Protection:
    // Modify a line in the screen so offsets/text no longer match the original plan
    await fs.writeFile(screenPath, screenContent + "\n// extra comment\n");
    const staleResult = await client.callTool({
      name: "apply_i18n_plan",
      arguments: {
        plan, // this original plan expected "Welcome back", but file now has {t("WELCOME_BACK")}
        projectPath: sandboxDir,
      },
    });
    expect(staleResult.isError).toBe(true);
    const staleParsed = extractJson<ApplyI18nPlanResult>(
      (staleResult.content[0] as { type: string; text: string }).text
    );
    expect(staleParsed.success).toBe(false);
    expect(staleParsed.errors.some((e) => e.code === "PLAN_STALE")).toBe(true);

    await client.close();
    await server.close();
  });

  it("communicates over stdio transport with the built server", async () => {
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

    // Generate plan
    const planResult = await client.callTool({
      name: "generate_i18n_plan",
      arguments: {
        projectPath: sandboxDir,
        scope: "src/features/auth/LoginScreen.tsx",
      },
    });
    const plan = extractJson<I18nPlan>(
      (planResult.content[0] as { type: string; text: string }).text
    );

    // Apply with dryRun
    const result = await client.callTool({
      name: "apply_i18n_plan",
      arguments: {
        plan,
        projectPath: sandboxDir,
        dryRun: true,
      },
    });

    expect(result.isError).toBeFalsy();
    const parsed = extractJson<ApplyI18nPlanResult>(
      (result.content[0] as { type: string; text: string }).text
    );
    expect(parsed.success).toBe(true);
    expect(parsed.dryRun).toBe(true);

    await client.close();
  });
});
