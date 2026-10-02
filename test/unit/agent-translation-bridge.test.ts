import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { translateI18n, lookupProvidedTranslation } from "../../src/core/translation/translation-service.js";
import { internationalizeProject } from "../../src/core/orchestration/internationalize-service.js";

describe("Agent Translation Bridge", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-bridge-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("lookupProvidedTranslation", () => {
    it("resolves nested namespace translations: provided[locale][namespace][key]", () => {
      const provided = {
        fr: {
          auth: {
            LOGIN: "Se connecter",
          },
        },
      };

      const result = lookupProvidedTranslation(provided, "fr", "auth", "LOGIN");
      expect(result).toBe("Se connecter");
    });

    it("resolves colon-prefixed compound keys: provided[locale]['namespace:key']", () => {
      const provided = {
        fr: {
          "auth:SIGN_UP": "S'inscrire",
        },
      };

      const result = lookupProvidedTranslation(provided, "fr", "auth", "SIGN_UP");
      expect(result).toBe("S'inscrire");
    });

    it("resolves dot-prefixed compound keys: provided[locale]['namespace.key']", () => {
      const provided = {
        fr: {
          "auth.LOGOUT": "Déconnexion",
        },
      };

      const result = lookupProvidedTranslation(provided, "fr", "auth", "LOGOUT");
      expect(result).toBe("Déconnexion");
    });

    it("resolves flat keys: provided[locale][key]", () => {
      const provided = {
        es: {
          SUBMIT: "Enviar",
        },
      };

      const result = lookupProvidedTranslation(provided, "es", "common", "SUBMIT");
      expect(result).toBe("Enviar");
    });

    it("returns undefined when locale or key is missing", () => {
      const provided = {
        fr: {
          SAVE: "Enregistrer",
        },
      };

      expect(lookupProvidedTranslation(provided, "de", "common", "SAVE")).toBeUndefined();
      expect(lookupProvidedTranslation(provided, "fr", "common", "CANCEL")).toBeUndefined();
      expect(lookupProvidedTranslation(undefined, "fr", "common", "SAVE")).toBeUndefined();
    });
  });

  describe("translateI18n with providedTranslations", () => {
    it("applies agent-provided translations and populates pendingItems for untranslated keys", async () => {
      // Setup mock project structure with source locale and empty target locale
      const localesDir = path.join(tempDir, "locales");
      const enDir = path.join(localesDir, "en");
      const frDir = path.join(localesDir, "fr");
      await fs.mkdir(enDir, { recursive: true });
      await fs.mkdir(frDir, { recursive: true });

      // en/auth.json
      await fs.writeFile(
        path.join(enDir, "auth.json"),
        JSON.stringify(
          {
            CUSTOM_HEADER: "Custom Application Header",
            UNKNOWN_ACTION: "Very obscure action string",
          },
          null,
          2
        )
      );

      // fr/auth.json (empty)
      await fs.writeFile(path.join(frDir, "auth.json"), JSON.stringify({}, null, 2));

      // Mock package.json to identify as project
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-app",
          dependencies: { "react-i18next": "^12.0.0" },
        })
      );

      // 1. Run with providedTranslations for CUSTOM_HEADER only
      const result = await translateI18n({
        projectPath: tempDir,
        sourceLocale: "en",
        targetLocales: ["fr"],
        namespaces: ["auth"],
        dryRun: false,
        providedTranslations: {
          fr: {
            auth: {
              CUSTOM_HEADER: "En-tête d'application personnalisée",
            },
          },
        },
      });

      expect(result.translated).toBe(1);
      expect(result.pending).toBe(1);
      expect(result.pendingItems).toBeDefined();
      expect(result.pendingItems).toHaveLength(1);
      expect(result.pendingItems![0]!.key).toBe("UNKNOWN_ACTION");
      expect(result.pendingItems![0]!.sourceText).toBe("Very obscure action string");
      expect(result.pendingItems![0]!.locale).toBe("fr");

      // Verify fr/auth.json was updated with CUSTOM_HEADER
      const frContent = JSON.parse(
        await fs.readFile(path.join(frDir, "auth.json"), "utf8")
      );
      expect(frContent.CUSTOM_HEADER).toBe("En-tête d'application personnalisée");
    });
  });

  describe("internationalizeProject with providedTranslations", () => {
    it("completes full migration and translates target locales via providedTranslations", async () => {
      // Setup a project with source code containing a hardcoded text
      const srcDir = path.join(tempDir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(path.join(localesDir, "en"), { recursive: true });
      await fs.mkdir(path.join(localesDir, "fr"), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify({
          name: "sample-app",
          dependencies: { "react-native": "^0.72.0", "react-i18next": "^12.0.0" },
        })
      );

      await fs.writeFile(
        path.join(localesDir, "en", "common.json"),
        JSON.stringify({}, null, 2)
      );
      await fs.writeFile(
        path.join(localesDir, "fr", "common.json"),
        JSON.stringify({}, null, 2)
      );

      await fs.writeFile(
        path.join(srcDir, "App.tsx"),
        `
        import React from 'react';
        import { Text } from 'react-native';
        export const App = () => <Text>Hello World Dashboard</Text>;
        `
      );

      const result = await internationalizeProject({
        projectPath: tempDir,
        sourceLocale: "en",
        targetLocales: ["fr"],
        apply: true,
        dryRun: false,
        translate: true,
        providedTranslations: {
          fr: {
            common: {
              HELLO_WORLD_DASHBOARD: "Tableau de bord Bonjour le Monde",
            },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("APPLIED");
      expect(result.translation?.translated).toBeGreaterThanOrEqual(1);

      // Check fr/common.json
      const frCommon = JSON.parse(
        await fs.readFile(path.join(localesDir, "fr", "common.json"), "utf8")
      );
      expect(frCommon.HELLO_WORLD_DASHBOARD).toBe("Tableau de bord Bonjour le Monde");
    });
  });
});
