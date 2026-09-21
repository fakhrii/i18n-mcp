import * as path from "node:path";
import * as fs from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

async function getDirectorySnapshot(dir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const content = await fs.readFile(full, "utf8");
        snapshot.set(path.relative(dir, full), content);
      }
    }
  }
  await walk(dir);
  return snapshot;
}

describe("Plan Generator (Core Planning Engine)", () => {
  it("generates a complete, deterministic plan for the fixture project", async () => {
    const plan = await generateI18nPlan({
      projectPath: FIXTURE_PATH,
    });

    expect(plan.version).toBe("1.0.0");
    expect(plan.project.framework).toBe("react-native");
    expect(plan.project.library).toBe("react-i18next");
    expect(plan.locales.source).toBe("en");
    expect(plan.locales.targets).toContain("fr");

    expect(plan.summary.totalDetected).toBeGreaterThanOrEqual(4);
    expect(plan.summary.userFacingCount).toBeGreaterThanOrEqual(4);
    expect(plan.summary.newKeysCount).toBeGreaterThan(0);

    // Verify translations list has expected items
    const keys = plan.translations.map((t) => `${t.namespace}:${t.key}`);
    expect(keys).toContain("auth:WELCOME_BACK");
    expect(keys).toContain("auth:ENTER_YOUR_EMAIL");
    expect(keys).toContain("auth:ENTER_YOUR_PASSWORD");
    expect(keys).toContain("profile:MANAGE_YOUR_PERSONAL_SETTINGS");

    // Verify each translation has sourceLocale and target plans
    const welcomeBack = plan.translations.find((t) => t.key === "WELCOME_BACK");
    expect(welcomeBack).toBeDefined();
    expect(welcomeBack?.sourceLocale.locale).toBe("en");
    expect(welcomeBack?.sourceLocale.value).toBe("Welcome back");
    expect(welcomeBack?.targets.some((tgt) => tgt.locale === "fr")).toBe(true);

    // Verify source changes
    expect(plan.sourceChanges.length).toBeGreaterThanOrEqual(4);
    const welcomeChange = plan.sourceChanges.find((s) => s.key === "WELCOME_BACK");
    expect(welcomeChange).toBeDefined();
    expect(welcomeChange?.file).toContain("LoginScreen.tsx");
    expect(welcomeChange?.replacement).toBe('{t("WELCOME_BACK")}');
  });

  it("filters plan by scope", async () => {
    const plan = await generateI18nPlan({
      projectPath: FIXTURE_PATH,
      scope: "src/features/auth",
    });

    expect(plan.summary.userFacingCount).toBe(3);
    for (const sc of plan.sourceChanges) {
      expect(sc.file).toContain("auth");
    }
  });

  it("is 100% non-destructive and leaves all fixture files completely untouched", async () => {
    const beforeSnapshot = await getDirectorySnapshot(FIXTURE_PATH);

    // Run planning
    const plan = await generateI18nPlan({
      projectPath: FIXTURE_PATH,
    });

    expect(plan).toBeDefined();

    const afterSnapshot = await getDirectorySnapshot(FIXTURE_PATH);

    // File count must match exactly
    expect(afterSnapshot.size).toBe(beforeSnapshot.size);

    // Every file must have identical content
    for (const [relPath, beforeContent] of beforeSnapshot.entries()) {
      const afterContent = afterSnapshot.get(relPath);
      expect(afterContent).toBeDefined();
      expect(afterContent).toBe(beforeContent);
    }
  });
});
