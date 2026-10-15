import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
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

  it("detects namespaces structureType for multi-file fixture", async () => {
    const allDeps = { "react-i18next": "^15.2.0" };
    const result = await detectI18n(FIXTURE_PATH, allDeps);

    expect(result.structureType).toBe("namespaces");
    expect(result.i18n.structureType).toBe("namespaces");
  });

  it("detects nested structureType for single-file nested JSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-nested-"));
    try {
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });
      await fs.writeFile(
        path.join(localesDir, "en.json"),
        JSON.stringify({
          auth: { login: "Login" },
          common: { save: "Save" },
        })
      );

      const result = await detectI18n(tempDir, { "react-i18next": "^15.2.0" });
      expect(result.structureType).toBe("nested");
      expect(result.i18n.structureType).toBe("nested");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects flat structureType for single-file flat JSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-flat-"));
    try {
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });
      await fs.writeFile(
        path.join(localesDir, "en.json"),
        JSON.stringify({
          login: "Login",
          save: "Save",
        })
      );

      const result = await detectI18n(tempDir, { "react-i18next": "^15.2.0" });
      expect(result.structureType).toBe("flat");
      expect(result.i18n.structureType).toBe("flat");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("respects user configuration structure override", async () => {
    const allDeps = { "react-i18next": "^15.2.0" };
    const result = await detectI18n(FIXTURE_PATH, allDeps, {
      structure: "nested",
    });

    expect(result.structureType).toBe("nested");
  });
});
