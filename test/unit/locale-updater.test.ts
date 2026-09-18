import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prepareLocaleUpdates } from "../../src/core/replacement/locale-updater.js";
import type { TranslationPlan } from "../../src/models/plan.js";

describe("Locale Updater", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-locale-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stages new translation entries preserving indentation", async () => {
    const localeFile = path.join(tempDir, "locales/en/auth.json");
    await fs.mkdir(path.dirname(localeFile), { recursive: true });
    await fs.writeFile(
      localeFile,
      JSON.stringify({ LOGIN: "Log in" }, null, 2) + "\n"
    );

    const translations: TranslationPlan[] = [
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
          },
        ],
        occurrences: 1,
      },
    ];

    const result = await prepareLocaleUpdates(tempDir, translations);

    expect(result.errors).toHaveLength(0);
    expect(result.translationEntriesCreated).toBe(1);
    expect(result.translationsPending).toBe(1);

    const staged = result.stagedFiles.get("locales/en/auth.json");
    expect(staged).toBeDefined();

    const parsed = JSON.parse(staged!);
    expect(parsed.LOGIN).toBe("Log in");
    expect(parsed.WELCOME_BACK).toBe("Welcome back");

    // Verify 2-space indentation preserved
    expect(staged).toContain('  "WELCOME_BACK": "Welcome back"');
  });

  it("detects key conflicts when key exists with different value", async () => {
    const localeFile = path.join(tempDir, "locales/en/auth.json");
    await fs.mkdir(path.dirname(localeFile), { recursive: true });
    await fs.writeFile(
      localeFile,
      JSON.stringify({ LOGIN: "Sign in" }, null, 2) + "\n"
    );

    const translations: TranslationPlan[] = [
      {
        namespace: "auth",
        key: "LOGIN",
        sourceText: "Log in now",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "Log in now",
          filePath: "locales/en/auth.json",
        },
        targets: [],
        occurrences: 1,
      },
    ];

    const result = await prepareLocaleUpdates(tempDir, translations);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.code).toBe("KEY_CONFLICT");
    expect(result.translationEntriesCreated).toBe(0);
  });

  it("handles identical existing value gracefully without error", async () => {
    const localeFile = path.join(tempDir, "locales/en/auth.json");
    await fs.mkdir(path.dirname(localeFile), { recursive: true });
    await fs.writeFile(
      localeFile,
      JSON.stringify({ LOGIN: "Log in" }, null, 2) + "\n"
    );

    const translations: TranslationPlan[] = [
      {
        namespace: "auth",
        key: "LOGIN",
        sourceText: "Log in",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "Log in",
          filePath: "locales/en/auth.json",
        },
        targets: [],
        occurrences: 1,
      },
    ];

    const result = await prepareLocaleUpdates(tempDir, translations);

    expect(result.errors).toHaveLength(0);
  });
});
