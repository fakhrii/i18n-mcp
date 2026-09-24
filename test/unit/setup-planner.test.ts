import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { planI18nSetup } from "../../src/core/setup/setup-planner.js";
import type { ProjectAnalysis } from "../../src/models/project.js";

describe("Greenfield i18n Setup Planner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-setup-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("plans setup for TypeScript React Native project with src directory and App.tsx", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "App.tsx"), "export default function App() { return null; }");

    const mockAnalysis: ProjectAnalysis = {
      framework: "react-native",
      language: "typescript",
      packageManager: "npm",
      i18n: {
        library: "none",
        detected: false,
        localeDirectory: null,
        sourceLocale: "en",
        targetLocales: ["fr", "es"],
        needsSetup: true,
      },
      namespaces: ["common"],
      projectStructure: { features: [], screens: [] },
      accessPatterns: [],
      warnings: [],
    };

    const plan = await planI18nSetup(tempDir, mockAnalysis, {
      sourceLocale: "en",
      targetLocales: ["fr", "es"],
    });

    expect(plan.needed).toBe(true);
    expect(plan.library).toBe("react-i18next");
    expect(plan.configFile).toBe("src/i18n/index.ts");
    expect(plan.localeDirectory).toBe("src/locales");
    expect(plan.entryFile).toBe("App.tsx");
    expect(plan.entryImportStatement).toBe(`import "./src/i18n";`);

    // Files to create: 1 config file + 3 locale resource files (en, fr, es)
    expect(plan.filesToCreate.length).toBe(4);
    const config = plan.filesToCreate.find((f) => f.type === "CONFIG");
    expect(config).toBeDefined();
    expect(config?.content).toContain("compatibilityJSON: \"v3\"");
    expect(config?.content).toContain("initReactI18next");
    expect(config?.content).toContain("fallbackLng: \"en\"");

    // Dependencies
    expect(plan.dependenciesToAdd).toHaveProperty("react-i18next");
    expect(plan.dependenciesToAdd).toHaveProperty("i18next");
  });

  it("plans setup for JavaScript project without src directory", async () => {
    await fs.writeFile(path.join(tempDir, "index.js"), "console.log('App started');");

    const mockAnalysis: ProjectAnalysis = {
      framework: "react-native",
      language: "javascript",
      packageManager: "npm",
      i18n: {
        library: "none",
        detected: false,
        localeDirectory: null,
        sourceLocale: "en",
        targetLocales: [],
        needsSetup: true,
      },
      namespaces: ["common"],
      projectStructure: { features: [], screens: [] },
      accessPatterns: [],
      warnings: [],
    };

    const plan = await planI18nSetup(tempDir, mockAnalysis);
    expect(plan.configFile).toBe("i18n.js");
    expect(plan.localeDirectory).toBe("locales");
    expect(plan.entryFile).toBe("index.js");
    expect(plan.entryImportStatement).toBe(`import "./i18n";`);
  });
});
