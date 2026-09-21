import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyI18nPlan } from "../../src/core/replacement/plan-applicator.js";
import type { I18nPlan } from "../../src/models/plan.js";

describe("Plan Applicator", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-applicator-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createMockPlan(): I18nPlan {
    return {
      version: "1.0.0",
      project: {
        root: tempDir,
        framework: "react-native",
        library: "react-i18next",
      },
      scope: { include: [], exclude: [] },
      locales: { source: "en", targets: ["fr"] },
      summary: {
        totalDetected: 1,
        userFacingCount: 1,
        ignoredCount: 0,
        reusedKeysCount: 0,
        newKeysCount: 1,
        requiresReviewCount: 0,
        sourceFilesAffected: 1,
        localeFilesAffected: 1,
      },
      translations: [
        {
          namespace: "auth",
          key: "WELCOME_BACK",
          sourceText: "Welcome back",
          action: "CREATE",
          matchType: "NONE",
          sourceLocale: {
            locale: "en",
            value: "Welcome back",
            filePath: "locales/en/auth.json",
          },
          targets: [
            {
              locale: "fr",
              action: "CREATE_TRANSLATION",
              filePath: "locales/fr/auth.json",
            },
          ],
          occurrences: 1,
        },
      ],
      sourceChanges: [
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: {
            line: 7,
            column: 16,
            endLine: 7,
            endColumn: 28,
          },
          source: "Welcome back",
          replacement: '{t("WELCOME_BACK")}',
          namespace: "auth",
          key: "WELCOME_BACK",
        },
      ],
      warnings: [],
      errors: [],
    };
  }

  it("performs dry-run without writing any files to disk", async () => {
    const screenPath = path.join(tempDir, "src/Screen.tsx");
    const authJsonPath = path.join(tempDir, "locales/en/auth.json");

    await fs.mkdir(path.dirname(screenPath), { recursive: true });
    await fs.mkdir(path.dirname(authJsonPath), { recursive: true });

    const originalScreen = [
      'import React from "react";',
      'import { Text } from "react-native";',
      'import { useTranslation } from "react-i18next";',
      '',
      'export function Screen() {',
      '  const { t } = useTranslation("auth");',
      '  return <Text>Welcome back</Text>;',
      '}',
    ].join("\n");

    await fs.writeFile(screenPath, originalScreen);
    await fs.writeFile(authJsonPath, JSON.stringify({ LOGIN: "Log in" }, null, 2));

    const plan = createMockPlan();

    const result = await applyI18nPlan({
      plan,
      projectPath: tempDir,
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.filesChanged).toHaveLength(2);
    expect(result.diff).toContain("+   return <Text>{t(\"WELCOME_BACK\")}</Text>;");

    // File on disk must remain unchanged!
    const diskContent = await fs.readFile(screenPath, "utf8");
    expect(diskContent).toBe(originalScreen);
  });

  it("writes changes to disk and creates backups when createBackup=true", async () => {
    const screenPath = path.join(tempDir, "src/Screen.tsx");
    const authJsonPath = path.join(tempDir, "locales/en/auth.json");

    await fs.mkdir(path.dirname(screenPath), { recursive: true });
    await fs.mkdir(path.dirname(authJsonPath), { recursive: true });

    const originalScreen = [
      'import React from "react";',
      'import { Text } from "react-native";',
      'import { useTranslation } from "react-i18next";',
      '',
      'export function Screen() {',
      '  const { t } = useTranslation("auth");',
      '  return <Text>Welcome back</Text>;',
      '}',
    ].join("\n");

    await fs.writeFile(screenPath, originalScreen);
    await fs.writeFile(authJsonPath, JSON.stringify({ LOGIN: "Log in" }, null, 2));

    const plan = createMockPlan();

    const result = await applyI18nPlan({
      plan,
      projectPath: tempDir,
      dryRun: false,
      createBackup: true,
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.sourceChangesApplied).toBe(1);
    expect(result.translationEntriesCreated).toBe(1);

    // Verify modified file on disk
    const diskScreen = await fs.readFile(screenPath, "utf8");
    expect(diskScreen).toContain('<Text>{t("WELCOME_BACK")}</Text>');

    // Verify backup file exists
    const backupScreen = await fs.readFile(`${screenPath}.bak`, "utf8");
    expect(backupScreen).toBe(originalScreen);

    // Verify locale file on disk
    const diskLocale = JSON.parse(await fs.readFile(authJsonPath, "utf8"));
    expect(diskLocale.LOGIN).toBe("Log in");
    expect(diskLocale.WELCOME_BACK).toBe("Welcome back");
  });
});
