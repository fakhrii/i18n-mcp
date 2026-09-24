import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { loadProjectConfig } from "../../src/config/config-loader.js";
import { parseCodeLevelI18nConfig, detectI18n } from "../../src/core/discovery/i18n-detector.js";

describe("Multi-source Project Config & Locale Detection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-cfg-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Config Loader (package.json, i18n.config.*)", () => {
    it("loads i18n config from package.json 'i18n' field", async () => {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "my-app",
          i18n: {
            sourceLocale: "fr",
            targetLocales: ["en", "es"],
            localeDirectory: "src/locales",
            namespaces: { auth: "auth", common: "common" },
          },
        }),
        "utf8"
      );

      const config = await loadProjectConfig(tempDir);
      expect(config).not.toBeNull();
      expect(config?.locales?.source).toBe("fr");
      expect(config?.locales?.targets).toEqual(["en", "es"]);
      expect(config?.localeDirectory).toBe("src/locales");
      expect(config?.namespaces).toEqual({ auth: "auth", common: "common" });
    });

    it("loads i18n config from package.json 'locales' array", async () => {
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "my-app",
          locales: ["en", "de", "ar"],
        }),
        "utf8"
      );

      const config = await loadProjectConfig(tempDir);
      expect(config).not.toBeNull();
      expect(config?.locales?.source).toBe("en");
      expect(config?.locales?.targets).toEqual(["de", "ar"]);
    });

    it("loads config from i18n.config.json", async () => {
      await fs.writeFile(
        path.join(tempDir, "i18n.config.json"),
        JSON.stringify({
          locales: {
            source: "es",
            targets: ["en", "pt"],
          },
          localeDirectory: "translations",
        }),
        "utf8"
      );

      const config = await loadProjectConfig(tempDir);
      expect(config).not.toBeNull();
      expect(config?.locales?.source).toBe("es");
      expect(config?.locales?.targets).toEqual(["en", "pt"]);
      expect(config?.localeDirectory).toBe("translations");
    });

    it("loads config from i18next-parser.config.js", async () => {
      await fs.writeFile(
        path.join(tempDir, "i18next-parser.config.js"),
        `module.exports = {
          locales: ['en', 'fr', 'ja'],
          defaultNamespace: 'translation',
          output: 'locales/$LOCALE/$NAMESPACE.json'
        };`,
        "utf8"
      );

      const config = await loadProjectConfig(tempDir);
      expect(config).not.toBeNull();
      expect(config?.locales?.source).toBe("en");
      expect(config?.locales?.targets).toEqual(["fr", "ja"]);
      expect(config?.namespaces).toEqual({ translation: "translation" });
      expect(config?.localeDirectory).toBe("locales");
    });
  });

  describe("Code-Level i18n Configuration Parser", () => {
    it("extracts fallbackLng, lng, supportedLngs, defaultNS, and ns", () => {
      const code = `
        import i18n from 'i18next';
        import { initReactI18next } from 'react-i18next';
        import enCommon from './locales/en.json';

        i18n.use(initReactI18next).init({
          fallbackLng: 'fr',
          lng: 'fr',
          supportedLngs: ['fr', 'en', 'ar', 'es'],
          defaultNS: 'common',
          ns: ['common', 'auth'],
          interpolation: { escapeValue: false }
        });
      `;

      const parsed = parseCodeLevelI18nConfig(code);
      expect(parsed.library).toBe("react-i18next");
      expect(parsed.sourceLocale).toBe("fr");
      expect(parsed.allLocales).toEqual(["fr", "en", "ar", "es"]);
      expect(parsed.defaultNamespace).toBe("common");
      expect(parsed.namespaces).toEqual(["common", "auth"]);
      expect(parsed.localeDirectory).toBe("locales");
    });

    it("extracts locale keys from resources object", () => {
      const code = `
        i18n.init({
          resources: {
            en: { translation: {} },
            es: { translation: {} },
            de: { translation: {} },
          }
        });
      `;

      const parsed = parseCodeLevelI18nConfig(code);
      expect(parsed.allLocales).toEqual(["en", "es", "de"]);
    });
  });

  describe("End-to-End detectI18n Locale & Config Resolution", () => {
    it("prioritizes code fallbackLng over default 'en'", async () => {
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "src/i18n.ts"),
        `
        import i18n from 'i18next';
        i18n.init({
          fallbackLng: 'de',
          supportedLngs: ['de', 'en', 'it'],
        });
        `,
        "utf8"
      );

      const result = await detectI18n(tempDir, { "react-i18next": "^14.0.0" }, null);
      expect(result.i18n.sourceLocale).toBe("de");
      expect(result.i18n.targetLocales).toEqual(["en", "it"]);
      expect(result.i18n.configFile).toBe("src/i18n.ts");
    });

    it("detects needsSetup=true for empty project without i18n", async () => {
      const result = await detectI18n(tempDir, {}, null);
      expect(result.i18n.library).toBe("none");
      expect(result.i18n.detected).toBe(false);
      expect(result.i18n.needsSetup).toBe(true);
      expect(result.i18n.sourceLocale).toBe("en");
      expect(result.i18n.targetLocales).toEqual([]);
    });
  });
});
