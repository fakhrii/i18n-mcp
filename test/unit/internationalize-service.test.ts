import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { internationalizeProject } from "../../src/core/orchestration/index.js";

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

describe("Internationalize Service Unit Tests", () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-orch-sandbox-"));
    await copyDir(FIXTURE_PATH, sandboxDir);
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it("returns NO_CHANGES early when scope has 0 hardcoded strings", async () => {
    // CustomButton.tsx in fixture has no hardcoded user-facing strings
    const res = await internationalizeProject({
      projectPath: sandboxDir,
      scope: ["src/components/CustomButton.tsx"],
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("NO_CHANGES");
    expect(res.scan.userFacing).toBe(0);
    expect(res.apply).toBeUndefined();
  });

  it("defaults to conservative dry-run with PLAN_READY and non-destructive diff", async () => {
    const loginScreen = path.join(sandboxDir, "src/features/auth/LoginScreen.tsx");
    const originalContent = await fs.readFile(loginScreen, "utf8");

    const res = await internationalizeProject({
      projectPath: sandboxDir,
      scope: ["src/features/auth"],
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("PLAN_READY");
    expect(res.scan.userFacing).toBe(3);
    expect(res.plan.changes).toBe(3);
    expect(res.diff).toBeDefined();
    expect(res.diff).toContain("Welcome back");
    expect(res.diff).toContain("WELCOME_BACK");

    // Verify files on disk were untouched
    const currentContent = await fs.readFile(loginScreen, "utf8");
    expect(currentContent).toBe(originalContent);
  });

  it("executes full pipeline with apply=true, translate=true, and reaches APPLIED status", async () => {
    const res = await internationalizeProject({
      projectPath: sandboxDir,
      scope: ["src/features/auth"],
      apply: true,
      dryRun: false,
      translate: true,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("APPLIED");
    expect(res.apply).toBeDefined();
    expect(res.apply?.filesChanged.length).toBeGreaterThanOrEqual(2);
    expect(res.apply?.sourceChangesApplied).toBe(3);
    expect(res.translation).toBeDefined();
    expect(res.translation?.translated).toBeGreaterThanOrEqual(1);
    expect(res.validation?.valid).toBe(true);

    // Verify source code on disk has t() calls
    const loginScreen = path.join(sandboxDir, "src/features/auth/LoginScreen.tsx");
    const updatedContent = await fs.readFile(loginScreen, "utf8");
    expect(updatedContent).toContain('{t("WELCOME_BACK")}');

    // Verify en locale has the new keys
    const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    expect(enAuth.WELCOME_BACK).toBe("Welcome back");

    // Verify fr locale has been translated by the translation service!
    const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
    const frAuth = JSON.parse(await fs.readFile(frAuthPath, "utf8"));
    expect(frAuth.WELCOME_BACK).toBe("Bienvenue");
    expect(frAuth.ENTER_YOUR_EMAIL).toBe("Entrez votre e-mail");
    expect(frAuth.ENTER_YOUR_PASSWORD).toBe("Entrez votre mot de passe");

    // 4. Test Idempotency: running internationalize again on the same scope produces NO_CHANGES
    const secondRun = await internationalizeProject({
      projectPath: sandboxDir,
      scope: ["src/features/auth"],
      apply: true,
      dryRun: false,
      translate: true,
    });

    expect(secondRun.success).toBe(true);
    expect(secondRun.status).toBe("NO_CHANGES");
    expect(secondRun.scan.userFacing).toBe(0);
  });
});
