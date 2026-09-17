import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { detectI18n } from "../../src/core/discovery/i18n-detector.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/react-native-app");

describe("i18n Detector", () => {
  it("detects react-i18next library and config file", async () => {
    const allDeps = {
      react: "18.3.1",
      "react-native": "0.76.0",
      i18next: "^24.2.0",
      "react-i18next": "^15.2.0",
    };
    const result = await detectI18n(FIXTURE_PATH, allDeps);

    expect(result.i18n.library).toBe("react-i18next");
    expect(result.i18n.detected).toBe(true);
    expect(result.i18n.localeDirectory).toBe("src/locales");
    expect(result.i18n.configFile).toBe("src/i18n/index.ts");
    expect(result.i18n.sourceLocale).toBe("en");
    expect(result.i18n.targetLocales).toContain("fr");
  });

  it("detects namespaces from locale directory structure", async () => {
    const allDeps = { "react-i18next": "^15.2.0" };
    const result = await detectI18n(FIXTURE_PATH, allDeps);

    expect(result.namespaces).toContain("common");
    expect(result.namespaces).toContain("auth");
    expect(result.namespaces).toContain("profile");
  });

  it("detects translation access patterns from code", async () => {
    const allDeps = { "react-i18next": "^15.2.0" };
    const result = await detectI18n(FIXTURE_PATH, allDeps);

    expect(result.accessPatterns).toContain("useTranslation");
    expect(result.accessPatterns).toContain("t");
  });
});
