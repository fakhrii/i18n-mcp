import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prepareLocaleUpdates } from "../../src/core/replacement/locale-updater.js";
import { translateI18n } from "../../src/core/translation/translation-service.js";
import { DictionaryTranslationProvider } from "../../src/core/translation/translation-provider.js";
import type { TranslationPlan } from "../../src/models/plan.js";

describe("Nested Locale Schema Preservation Tests", () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-nested-schema-"));
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it("populates empty placeholder in-place in nested schema without KEY_CONFLICT or flat keys", async () => {
    const localeRelPath = "locales/en.json";
    const absLocalePath = path.join(sandboxDir, localeRelPath);
    await fs.mkdir(path.dirname(absLocalePath), { recursive: true });

    const originalJson = {
      PISPI: {
        ONBOARDING: {
          HERO_TITLE: "",
          SUBTITLE: "Existing Subtitle",
        },
      },
    };
    await fs.writeFile(absLocalePath, JSON.stringify(originalJson, null, 2), "utf8");

    const plannedTranslations: TranslationPlan[] = [
      {
        namespace: "PISPI",
        key: "ONBOARDING.HERO_TITLE",
        sourceText: "Welcome to Our App",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "Welcome to Our App",
          filePath: localeRelPath,
        },
        targets: [],
      },
    ];

    const result = await prepareLocaleUpdates(sandboxDir, plannedTranslations);

    expect(result.errors).toHaveLength(0);
    expect(result.translationEntriesCreated).toBe(1);

    const stagedContent = result.stagedFiles.get(localeRelPath);
    expect(stagedContent).toBeDefined();

    const parsed = JSON.parse(stagedContent!);
    // 1. HERO_TITLE is updated in-place
    expect(parsed.PISPI.ONBOARDING.HERO_TITLE).toBe("Welcome to Our App");
    // 2. Subtitle sibling is untouched
    expect(parsed.PISPI.ONBOARDING.SUBTITLE).toBe("Existing Subtitle");
    // 3. No flat key was created inside PISPI
    expect(parsed.PISPI["ONBOARDING.HERO_TITLE"]).toBeUndefined();
    // 4. No flat key was created at root
    expect(parsed["ONBOARDING.HERO_TITLE"]).toBeUndefined();
    expect(parsed["PISPI.ONBOARDING.HERO_TITLE"]).toBeUndefined();
  });

  it("adds new nested key into existing section without creating flat dotted keys", async () => {
    const localeRelPath = "locales/en.json";
    const absLocalePath = path.join(sandboxDir, localeRelPath);
    await fs.mkdir(path.dirname(absLocalePath), { recursive: true });

    const originalJson = {
      PISPI: {
        ONBOARDING: {
          HERO_TITLE: "Welcome",
        },
      },
    };
    await fs.writeFile(absLocalePath, JSON.stringify(originalJson, null, 2), "utf8");

    const plannedTranslations: TranslationPlan[] = [
      {
        namespace: "PISPI",
        key: "ONBOARDING.HERO_SUBTITLE",
        sourceText: "Start your journey today",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "Start your journey today",
          filePath: localeRelPath,
        },
        targets: [],
      },
    ];

    const result = await prepareLocaleUpdates(sandboxDir, plannedTranslations);

    expect(result.errors).toHaveLength(0);
    expect(result.translationEntriesCreated).toBe(1);

    const stagedContent = result.stagedFiles.get(localeRelPath)!;
    const parsed = JSON.parse(stagedContent);

    // Verify it is placed inside PISPI.ONBOARDING as a nested child
    expect(parsed.PISPI.ONBOARDING.HERO_TITLE).toBe("Welcome");
    expect(parsed.PISPI.ONBOARDING.HERO_SUBTITLE).toBe("Start your journey today");
    expect(parsed.PISPI["ONBOARDING.HERO_SUBTITLE"]).toBeUndefined();
    expect(parsed["ONBOARDING.HERO_SUBTITLE"]).toBeUndefined();
  });

  it("translates nested single-file schema into target locale preserving hierarchy", async () => {
    // Setup minimal project with locales/en.json and locales/fr.json
    const enRelPath = "locales/en.json";
    const frRelPath = "locales/fr.json";
    const absEnPath = path.join(sandboxDir, enRelPath);
    const absFrPath = path.join(sandboxDir, frRelPath);
    await fs.mkdir(path.join(sandboxDir, "locales"), { recursive: true });

    // Package.json to identify project
    await fs.writeFile(
      path.join(sandboxDir, "package.json"),
      JSON.stringify({
        name: "test-nested",
        dependencies: { "react-native": "0.72.0", "react-i18next": "13.0.0" },
      }),
      "utf8"
    );

    const enJson = {
      PISPI: {
        ONBOARDING: {
          HERO_TITLE: "Save",
        },
      },
    };
    const frJson = {
      PISPI: {
        ONBOARDING: {
          HERO_TITLE: "",
        },
      },
    };

    await fs.writeFile(absEnPath, JSON.stringify(enJson, null, 2), "utf8");
    await fs.writeFile(absFrPath, JSON.stringify(frJson, null, 2), "utf8");

    const transResult = await translateI18n({
      projectPath: sandboxDir,
      sourceLocale: "en",
      targetLocales: ["fr"],
      dryRun: false,
    });

    expect(transResult.errors).toHaveLength(0);
    expect(transResult.translated).toBe(1);

    const updatedFr = JSON.parse(await fs.readFile(absFrPath, "utf8"));
    // Translated into "Enregistrer" in fr
    expect(updatedFr.PISPI.ONBOARDING.HERO_TITLE).toBe("Enregistrer");
    // Never create flat dotted key
    expect(updatedFr.PISPI["ONBOARDING.HERO_TITLE"]).toBeUndefined();
    expect(updatedFr["ONBOARDING.HERO_TITLE"]).toBeUndefined();
  });

  it("handles subdirectory layout locales/en/pispi.json preserving nested keys", async () => {
    const pispiRelPath = "locales/en/pispi.json";
    const absPispiPath = path.join(sandboxDir, pispiRelPath);
    await fs.mkdir(path.dirname(absPispiPath), { recursive: true });

    const originalPispi = {
      ONBOARDING: {
        HERO_TITLE: "",
      },
    };
    await fs.writeFile(absPispiPath, JSON.stringify(originalPispi, null, 2), "utf8");

    const plannedTranslations: TranslationPlan[] = [
      {
        namespace: "pispi",
        key: "ONBOARDING.HERO_TITLE",
        sourceText: "Welcome",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "Welcome",
          filePath: pispiRelPath,
        },
        targets: [],
      },
    ];

    const result = await prepareLocaleUpdates(sandboxDir, plannedTranslations);

    expect(result.errors).toHaveLength(0);
    const stagedContent = result.stagedFiles.get(pispiRelPath)!;
    const parsed = JSON.parse(stagedContent);

    // In pispi.json, it should be parsed.ONBOARDING.HERO_TITLE, NOT parsed.pispi.ONBOARDING.HERO_TITLE
    expect(parsed.ONBOARDING.HERO_TITLE).toBe("Welcome");
    expect(parsed.pispi).toBeUndefined();
    expect(parsed["ONBOARDING.HERO_TITLE"]).toBeUndefined();
  });
});
