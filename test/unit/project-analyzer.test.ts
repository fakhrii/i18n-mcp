import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { analyzeProject } from "../../src/core/discovery/project-analyzer.js";
import { I18nMcpError } from "../../src/models/errors.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("Project Analyzer", () => {
  it("performs complete analysis of the fixture React Native project", async () => {
    const analysis = await analyzeProject(FIXTURE_PATH);

    expect(analysis.framework).toBe("react-native");
    expect(analysis.language).toBe("typescript");
    expect(analysis.packageManager).toBe("yarn");

    expect(analysis.i18n.library).toBe("react-i18next");
    expect(analysis.i18n.detected).toBe(true);
    expect(analysis.i18n.localeDirectory).toBe("src/locales");
    expect(analysis.i18n.sourceLocale).toBe("en");
    expect(analysis.i18n.targetLocales).toEqual(["fr"]);

    expect(analysis.namespaces).toEqual(["auth", "common", "profile"]);
    expect(analysis.projectStructure.features).toEqual(["auth", "profile"]);
    expect(analysis.accessPatterns).toContain("useTranslation");
    expect(analysis.accessPatterns).toContain("t");
  });

  it("throws I18nMcpError for non-existent path", async () => {
    await expect(
      analyzeProject(path.join(FIXTURE_PATH, "non-existent-directory"))
    ).rejects.toThrow(I18nMcpError);
  });
});
