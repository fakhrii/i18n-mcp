import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { analyzeProject } from "../../src/core/discovery/project-analyzer.js";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import { applyI18nPlan } from "../../src/core/replacement/plan-applicator.js";
import { internationalizeProject } from "../../src/core/orchestration/internationalize-service.js";
import { fileExists, readJsonFile, readTextFile } from "../../src/utils/file-system.js";

describe("Greenfield React Native App Internationalization", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-greenfield-test-"));

    // 1. package.json without any i18n dependencies
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "blank-rn-app",
          version: "1.0.0",
          dependencies: {
            react: "18.3.1",
            "react-native": "0.76.0",
          },
        },
        null,
        2
      )
    );

    // 2. tsconfig.json
    await fs.writeFile(
      path.join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react" } })
    );

    // 3. App.tsx with hardcoded strings
    await fs.writeFile(
      path.join(tempDir, "App.tsx"),
      `import React from 'react';
import { View, Text, Button } from 'react-native';

export default function App() {
  return (
    <View>
      <Text>Welcome to the New App</Text>
      <Button title="Get Started" onPress={() => {}} />
    </View>
  );
}
`,
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects missing i18n infrastructure in blank project", async () => {
    const analysis = await analyzeProject(tempDir);
    expect(analysis.i18n.detected).toBe(false);
    expect(analysis.i18n.library).toBe("none");
    expect(analysis.i18n.needsSetup).toBe(true);
  });

  it("plans i18n setup, config file, entry injection, and translations", async () => {
    const plan = await generateI18nPlan({ projectPath: tempDir });
    expect(plan.setup).toBeDefined();
    expect(plan.setup?.needed).toBe(true);
    expect(plan.setup?.configFile).toBe("i18n.ts");
    expect(plan.setup?.entryFile).toBe("App.tsx");
    expect(plan.setup?.entryImportStatement).toBe(`import "./i18n";`);
    expect(plan.sourceChanges.length).toBeGreaterThan(0);
    expect(plan.translations.length).toBeGreaterThan(0);
  });

  it("generates complete preview diff in dryRun without modifying disk", async () => {
    const plan = await generateI18nPlan({ projectPath: tempDir });
    const dryRunResult = await applyI18nPlan({
      projectPath: tempDir,
      plan,
      dryRun: true,
    });

    expect(dryRunResult.success).toBe(true);
    expect(dryRunResult.dryRun).toBe(true);
    expect(dryRunResult.diff).toBeDefined();
    expect(dryRunResult.diff).toContain("+++ b/i18n.ts");
    expect(dryRunResult.diff).toContain("+++ b/package.json");
    expect(dryRunResult.diff).toContain(`+ import "./i18n";`);

    // Verify disk was NOT touched
    expect(await fileExists(path.join(tempDir, "i18n.ts"))).toBe(false);
    expect(await fileExists(path.join(tempDir, "locales"))).toBe(false);
  });

  it("applies setup, writes i18n.ts, updates package.json, and achieves idempotency", async () => {
    // 1. Run internationalizeProject with apply=true
    const result = await internationalizeProject({
      projectPath: tempDir,
      dryRun: false,
      apply: true,
    });

    expect(result.success).toBe(true);
    expect(["APPLIED", "APPLIED_WITH_WARNINGS"]).toContain(result.status);

    // 2. Verify i18n config was created
    const i18nConfigPath = path.join(tempDir, "i18n.ts");
    expect(await fileExists(i18nConfigPath)).toBe(true);
    const i18nContent = await readTextFile(i18nConfigPath);
    expect(i18nContent).toContain("initReactI18next");
    expect(i18nContent).toContain("compatibilityJSON: \"v3\"");

    // 3. Verify App.tsx has import and localized strings
    const appContent = await readTextFile(path.join(tempDir, "App.tsx"));
    expect(appContent).toContain(`import "./i18n";`);
    expect(appContent).toContain("useTranslation");
    expect(appContent).toContain("t(");

    // 4. Verify package.json dependencies updated
    const pkgJson = await readJsonFile<any>(path.join(tempDir, "package.json"));
    expect(pkgJson.dependencies).toHaveProperty("react-i18next");
    expect(pkgJson.dependencies).toHaveProperty("i18next");

    // 5. Verify locale JSON file created
    const localeJsonPath = path.join(tempDir, "locales/en/common.json");
    expect(await fileExists(localeJsonPath)).toBe(true);
    const localeJson = await readJsonFile<any>(localeJsonPath);
    expect(Object.keys(localeJson).length).toBeGreaterThan(0);

    // 6. Test Idempotency: re-running internationalizeProject should yield NO_CHANGES
    const secondRun = await internationalizeProject({
      projectPath: tempDir,
      dryRun: true,
    });
    expect(secondRun.status).toBe("NO_CHANGES");
  });
});
