import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  translateI18n,
  DictionaryTranslationProvider,
} from "../../src/core/translation/index.js";

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

describe("Translation Service & Provider Unit Tests", () => {
  describe("DictionaryTranslationProvider", () => {
    const provider = new DictionaryTranslationProvider();

    it("translates known terms to French", async () => {
      const res = await provider.translate({
        text: "Log in",
        sourceLocale: "en",
        targetLocale: "fr",
      });
      expect(res.translated).toBe(true);
      expect(res.translatedText).toBe("Se connecter");
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("translates known terms to Spanish", async () => {
      const res = await provider.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "es",
      });
      expect(res.translated).toBe(true);
      expect(res.translatedText).toBe("Guardar");
    });

    it("preserves interpolation placeholders like {{var}} and {var}", async () => {
      const res = await provider.translate({
        text: "Welcome back {{userName}}",
        sourceLocale: "en",
        targetLocale: "fr",
      });
      expect(res.translated).toBe(true);
      expect(res.translatedText).toBe("Bienvenue {{userName}}");
    });

    it("prioritizes glossary over built-in dictionary", async () => {
      const res = await provider.translate({
        text: "Save",
        sourceLocale: "en",
        targetLocale: "fr",
        glossary: {
          save: "Sauvegarder",
        },
      });
      expect(res.translated).toBe(true);
      expect(res.translatedText).toBe("Sauvegarder");
    });

    it("returns pending status for unknown terms", async () => {
      const res = await provider.translate({
        text: "Xylophone Quantum Quasar 12345",
        sourceLocale: "en",
        targetLocale: "fr",
      });
      expect(res.translated).toBe(false);
      expect(res.confidence).toBe(0.0);
      expect(res.translatedText).toBe("Xylophone Quantum Quasar 12345");
    });
  });

  describe("translateI18n service", () => {
    let sandboxDir: string;

    beforeEach(async () => {
      sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-trans-sandbox-"));
      await copyDir(FIXTURE_PATH, sandboxDir);
    });

    afterEach(async () => {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    });

    it("respects dryRun and does not modify disk", async () => {
      // In fixture, fr/auth.json has LOGIN, FORGOT_PASSWORD, LOGOUT.
      // Let's add a new key NEW_FEATURE: "Save" to en/auth.json
      const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
      const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
      enAuth.NEW_KEY = "Save";
      await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

      const res = await translateI18n({
        projectPath: sandboxDir,
        dryRun: true,
      });

      expect(res.errors).toHaveLength(0);
      expect(res.translated).toBeGreaterThanOrEqual(1);

      // Verify fr/auth.json on disk was NOT modified
      const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
      const frAuth = JSON.parse(await fs.readFile(frAuthPath, "utf8"));
      expect(frAuth.NEW_KEY).toBeUndefined();
    });

    it("translates missing keys and updates target files when dryRun=false", async () => {
      const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
      const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
      enAuth.NEW_KEY = "Save";
      await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

      const res = await translateI18n({
        projectPath: sandboxDir,
        dryRun: false,
      });

      expect(res.errors).toHaveLength(0);
      expect(res.filesModified).toContain("src/locales/fr/auth.json");

      // Verify fr/auth.json was updated with "Enregistrer"
      const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
      const frAuth = JSON.parse(await fs.readFile(frAuthPath, "utf8"));
      expect(frAuth.NEW_KEY).toBe("Enregistrer");

      // Verify existing keys in fr/auth.json were untouched
      expect(frAuth.LOGIN).toBe("Se connecter");
      expect(frAuth.FORGOT_PASSWORD).toBe("Mot de passe oublié ?");
    });

    it("filters translations by namespace when specified", async () => {
      // Add missing key to en/auth.json and en/common.json
      const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
      const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
      enAuth.AUTH_NEW = "Log in";
      await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

      const enCommonPath = path.join(sandboxDir, "src/locales/en/common.json");
      const enCommon = JSON.parse(await fs.readFile(enCommonPath, "utf8"));
      enCommon.COMMON_NEW = "Cancel";
      await fs.writeFile(enCommonPath, JSON.stringify(enCommon, null, 2));

      const res = await translateI18n({
        projectPath: sandboxDir,
        namespaces: ["auth"],
        dryRun: false,
      });

      expect(res.filesModified).toContain("src/locales/fr/auth.json");
      expect(res.filesModified).not.toContain("src/locales/fr/common.json");
    });

    it("translates Flutter ARB catalogs and respects providedTranslations", async () => {
      const flutterDir = await fs.mkdtemp(path.join(os.tmpdir(), "flutter-arb-trans-"));
      try {
        await fs.writeFile(
          path.join(flutterDir, "pubspec.yaml"),
          "name: flutter_app\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_localizations:\n    sdk: flutter\n"
        );
        const l10nDir = path.join(flutterDir, "lib/l10n");
        await fs.mkdir(l10nDir, { recursive: true });

        await fs.writeFile(
          path.join(l10nDir, "app_en.arb"),
          JSON.stringify({
            "@@locale": "en",
            saveButton: "Save",
            cancelButton: "Cancel",
            customText: "Custom original phrase",
          })
        );

        const res = await translateI18n({
          projectPath: flutterDir,
          targetLocales: ["es"],
          dryRun: false,
          providedTranslations: {
            es: {
              customText: "Frase original personalizada",
            },
          },
        });

        expect(res.errors).toHaveLength(0);
        expect(res.filesModified).toContain("lib/l10n/app_es.arb");

        const esContent = await fs.readFile(path.join(l10nDir, "app_es.arb"), "utf8");
        const parsedEs = JSON.parse(esContent);
        expect(parsedEs["@@locale"]).toBe("es");
        expect(parsedEs["saveButton"]).toBe("Guardar");
        expect(parsedEs["cancelButton"]).toBe("Cancelar");
        expect(parsedEs["customText"]).toBe("Frase original personalizada");
      } finally {
        await fs.rm(flutterDir, { recursive: true, force: true });
      }
    });

    it("translates single-file nested JSON without dropping top-level sections", async () => {
      const nestedDir = await fs.mkdtemp(path.join(os.tmpdir(), "nested-trans-"));
      try {
        await fs.writeFile(
          path.join(nestedDir, "package.json"),
          JSON.stringify({ name: "nested-app", dependencies: { next: "14.0.0" } }),
          "utf8"
        );
        const localesDir = path.join(nestedDir, "messages");
        await fs.mkdir(localesDir, { recursive: true });

        const enJson = {
          onboarding: {
            title: "Welcome",
            step1: {
              description: "Get started now",
            },
          },
        };
        await fs.writeFile(
          path.join(localesDir, "en.json"),
          JSON.stringify(enJson, null, 2),
          "utf8"
        );

        const res = await translateI18n({
          projectPath: nestedDir,
          sourceLocale: "en",
          targetLocales: ["fr"],
          providedTranslations: {
            fr: {
              onboarding: {
                title: "Bienvenue",
                step1: {
                  description: "Commencez maintenant",
                },
              },
            },
          },
        });

        expect(res.errors).toHaveLength(0);
        expect(res.filesModified).toContain("messages/fr.json");

        const frContent = await fs.readFile(path.join(localesDir, "fr.json"), "utf8");
        const parsedFr = JSON.parse(frContent);

        // Section "onboarding" must be preserved!
        expect(parsedFr.onboarding).toBeDefined();
        expect(parsedFr.onboarding.title).toBe("Bienvenue");
        expect(parsedFr.onboarding.step1.description).toBe("Commencez maintenant");
        // Must NOT be flattened to root or wrapped in "common"
        expect(parsedFr.title).toBeUndefined();
        expect(parsedFr.common).toBeUndefined();
      } finally {
        await fs.rm(nestedDir, { recursive: true, force: true });
      }
    });
  });
});
