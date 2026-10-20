import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateI18n } from "../../src/core/validation/index.js";

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

describe("i18n Validator Unit Tests", () => {
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-val-sandbox-"));
    await copyDir(FIXTURE_PATH, sandboxDir);
  });

  afterEach(async () => {
    await fs.rm(sandboxDir, { recursive: true, force: true });
  });

  it("validates clean fixture project with zero errors", async () => {
    const res = await validateI18n({
      projectPath: sandboxDir,
    });

    expect(res.valid).toBe(true);
    expect(res.errorCount).toBe(0);
    expect(res.summary.localesChecked).toContain("en");
    expect(res.summary.localesChecked).toContain("fr");
  });

  it("detects MISSING_TRANSLATION when target locale lacks a key", async () => {
    // Add a key to en/auth.json that is not in fr/auth.json
    const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    enAuth.EXTRA_KEY = "Extra Key";
    await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

    const res = await validateI18n({
      projectPath: sandboxDir,
    });

    expect(res.valid).toBe(false);
    expect(res.errorCount).toBeGreaterThanOrEqual(1);
    const missingIssue = res.issues.find(
      (i) => i.type === "MISSING_TRANSLATION" && i.key === "EXTRA_KEY"
    );
    expect(missingIssue).toBeDefined();
    expect(missingIssue?.locale).toBe("fr");
    expect(missingIssue?.severity).toBe("error");
  });

  it("detects MISSING_VARIABLE when interpolation variables mismatch", async () => {
    // en has {{count}} apples, fr has {{total}} pommes
    const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    enAuth.ITEM_COUNT = "You have {{count}} items";
    await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2));

    const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
    const frAuth = JSON.parse(await fs.readFile(frAuthPath, "utf8"));
    frAuth.ITEM_COUNT = "Vous avez {{total}} éléments";
    await fs.writeFile(frAuthPath, JSON.stringify(frAuth, null, 2));

    const res = await validateI18n({
      projectPath: sandboxDir,
    });

    expect(res.valid).toBe(false);
    const varIssue = res.issues.find(
      (i) => i.type === "MISSING_VARIABLE" && i.key === "ITEM_COUNT"
    );
    expect(varIssue).toBeDefined();
    expect(varIssue?.severity).toBe("error");
    expect(varIssue?.message).toContain("Expected: [count]");
    expect(varIssue?.message).toContain("found: [total]");
  });

  it("detects ORPHAN_KEY when target locale has keys not in source", async () => {
    // fr has GHOST_KEY, en does not
    const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
    const frAuth = JSON.parse(await fs.readFile(frAuthPath, "utf8"));
    frAuth.GHOST_KEY = "Fantôme";
    await fs.writeFile(frAuthPath, JSON.stringify(frAuth, null, 2));

    const res = await validateI18n({
      projectPath: sandboxDir,
    });

    const orphanIssue = res.issues.find(
      (i) => i.type === "ORPHAN_KEY" && i.key === "GHOST_KEY"
    );
    expect(orphanIssue).toBeDefined();
    expect(orphanIssue?.severity).toBe("warning");
    // Orphan key is a warning, so valid can still be true if no errors
    expect(res.warningCount).toBeGreaterThanOrEqual(1);
  });

  it("detects MALFORMED_JSON in locale file", async () => {
    const frAuthPath = path.join(sandboxDir, "src/locales/fr/auth.json");
    await fs.writeFile(frAuthPath, "{ invalid json ...", "utf8");

    const res = await validateI18n({
      projectPath: sandboxDir,
    });

    expect(res.valid).toBe(false);
    const jsonIssue = res.issues.find((i) => i.type === "MALFORMED_JSON");
    expect(jsonIssue).toBeDefined();
    expect(jsonIssue?.severity).toBe("error");
  });

  it("detects HARDCODED_STRING when checkSourceCode is enabled", async () => {
    const res = await validateI18n({
      projectPath: sandboxDir,
      checkSourceCode: true,
      scope: ["src/features/auth"],
    });

    // Fixture LoginScreen has hardcoded strings before migration
    const hardcodedIssues = res.issues.filter((i) => i.type === "HARDCODED_STRING");
    expect(hardcodedIssues.length).toBeGreaterThan(0);
  });

  it("detects UNUSED_KEY and prunes dead keys when enabled", async () => {
    // Add a dead key to en/auth.json
    const enAuthPath = path.join(sandboxDir, "src/locales/en/auth.json");
    const enAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    enAuth.UNUSED_SIGNIN_PROMPT = "Old sign in prompt";
    await fs.writeFile(enAuthPath, JSON.stringify(enAuth, null, 2), "utf8");

    // 1. Check with checkUnusedKeys: true
    const checkRes = await validateI18n({
      projectPath: sandboxDir,
      checkUnusedKeys: true,
      scope: ["src/features/auth"],
    });

    const unusedIssue = checkRes.issues.find(
      (i) => i.type === "UNUSED_KEY" && i.key === "UNUSED_SIGNIN_PROMPT"
    );
    expect(unusedIssue).toBeDefined();
    expect(checkRes.summary.unusedKeysCount).toBeGreaterThanOrEqual(1);

    // 2. Prune with pruneUnusedKeys: true
    const pruneRes = await validateI18n({
      projectPath: sandboxDir,
      pruneUnusedKeys: true,
      scope: ["src/features/auth"],
    });

    expect(pruneRes.summary.prunedKeysCount).toBeGreaterThanOrEqual(1);
    const updatedEnAuth = JSON.parse(await fs.readFile(enAuthPath, "utf8"));
    expect(updatedEnAuth.UNUSED_SIGNIN_PROMPT).toBeUndefined();
  });

  it("validates Flutter ARB catalogs and detects missing keys across locales", async () => {
    const flutterDir = await fs.mkdtemp(path.join(os.tmpdir(), "flutter-arb-val-"));
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
          appTitle: "My App",
          welcomeMessage: "Welcome {user}",
        })
      );

      await fs.writeFile(
        path.join(l10nDir, "app_es.arb"),
        JSON.stringify({
          "@@locale": "es",
          appTitle: "Mi Aplicación",
          // missing welcomeMessage
        })
      );

      const res = await validateI18n({
        projectPath: flutterDir,
        locales: ["es"],
      });

      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.type === "MISSING_TRANSLATION" && i.key === "welcomeMessage")).toBe(true);
    } finally {
      await fs.rm(flutterDir, { recursive: true, force: true });
    }
  });
});
