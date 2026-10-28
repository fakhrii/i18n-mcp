import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  calculateStringSimilarity,
  normalizeForSimilarity,
} from "../../src/core/deduplication/similarity.js";
import { auditDuplicates } from "../../src/core/deduplication/deduplication-engine.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Deduplication & Similarity Engine", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dedupe-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("String Normalization & Similarity Calculations", () => {
    it("should normalize casing, quotes, and punctuation", () => {
      expect(normalizeForSimilarity('  "Save Changes!"  ')).toBe("save changes");
      expect(normalizeForSimilarity("Are you sure?")).toBe("are you sure");
      expect(normalizeForSimilarity("Hello, World;")).toBe("hello world");
    });

    it("should return 1.0 for normalized identical strings", () => {
      expect(calculateStringSimilarity("Save changes", "Save Changes!")).toBe(1.0);
      expect(calculateStringSimilarity('"Cancel"', "cancel.")).toBe(1.0);
    });

    it("should return high similarity (>= 0.85) for minor variations", () => {
      const sim = calculateStringSimilarity("Delete item", "Delete items");
      expect(sim).toBeGreaterThanOrEqual(0.85);
    });

    it("should return low similarity for completely different strings", () => {
      const sim = calculateStringSimilarity("Save document", "Cancel subscription");
      expect(sim).toBeLessThan(0.3);
    });
  });

  describe("Exact Duplicate and Cross-Namespace Detection", () => {
    it("should detect exact duplicates across different namespaces", async () => {
      const pkg = { name: "test-app", dependencies: { "react-i18next": "^12.0.0" } };
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg), "utf8");

      const localesDir = path.join(tmpDir, "locales", "en");
      await fs.mkdir(localesDir, { recursive: true });

      const authNs = {
        cancel_button: "Cancel",
        login: "Log In",
      };
      const profileNs = {
        cancel_action: "Cancel",
        edit: "Edit Profile",
      };
      const commonNs = {
        cancel: "Cancel",
      };

      await fs.writeFile(path.join(localesDir, "auth.json"), JSON.stringify(authNs, null, 2), "utf8");
      await fs.writeFile(path.join(localesDir, "profile.json"), JSON.stringify(profileNs, null, 2), "utf8");
      await fs.writeFile(path.join(localesDir, "common.json"), JSON.stringify(commonNs, null, 2), "utf8");

      const result = await auditDuplicates({ projectPath: tmpDir });

      expect(result.totalKeysScanned).toBe(5);
      expect(result.crossNamespaceDuplicatesCount).toBe(2);
      expect(result.clusters).toHaveLength(1);

      const cluster = result.clusters[0]!;
      expect(cluster.value).toBe("Cancel");
      expect(cluster.totalOccurrences).toBe(3);
      // Prefers key in 'common' namespace
      expect(cluster.canonicalNamespace).toBe("common");
      expect(cluster.canonicalKey).toBe("cancel");
    });

    it("should detect fuzzy near-duplicates", async () => {
      const pkg = { name: "test-app", dependencies: { "react-i18next": "^12.0.0" } };
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg), "utf8");

      const localesDir = path.join(tmpDir, "locales", "en");
      await fs.mkdir(localesDir, { recursive: true });

      const settingsNs = {
        delete_prompt: "Delete item",
        delete_prompt_plural: "Delete items",
      };
      await fs.writeFile(path.join(localesDir, "settings.json"), JSON.stringify(settingsNs, null, 2), "utf8");

      const result = await auditDuplicates({
        projectPath: tmpDir,
        similarityThreshold: 0.85,
      });

      expect(result.fuzzyDuplicatesCount).toBe(1);
      const fuzzyMatch = result.matches.find((m) => m.matchType === "FUZZY");
      expect(fuzzyMatch).toBeDefined();
      expect(fuzzyMatch?.similarity).toBeGreaterThanOrEqual(0.85);
      expect(fuzzyMatch?.keyA).toBe("delete_prompt");
      expect(fuzzyMatch?.keyB).toBe("delete_prompt_plural");
    });
  });

  describe("Automated Key Consolidation & Call-site Updating", () => {
    it("should consolidate duplicate keys and update source code references", async () => {
      const pkg = { name: "test-app", dependencies: { "react-i18next": "^12.0.0" } };
      await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify(pkg), "utf8");

      const localesDir = path.join(tmpDir, "locales", "en");
      await fs.mkdir(localesDir, { recursive: true });

      const authNs = {
        cancel_btn: "Cancel",
        submit: "Submit",
      };
      const commonNs = {
        cancel: "Cancel",
      };

      await fs.writeFile(path.join(localesDir, "auth.json"), JSON.stringify(authNs, null, 2), "utf8");
      await fs.writeFile(path.join(localesDir, "common.json"), JSON.stringify(commonNs, null, 2), "utf8");

      const srcDir = path.join(tmpDir, "src");
      await fs.mkdir(srcDir, { recursive: true });

      const componentCode = `
import React from 'react';
import { useTranslation } from 'react-i18next';

export function LoginDialog() {
  const { t } = useTranslation();
  return <button>{t("auth.cancel_btn")}</button>;
}
`;
      const compPath = path.join(srcDir, "LoginDialog.tsx");
      await fs.writeFile(compPath, componentCode, "utf8");

      // 1. Dry run
      const dryResult = await auditDuplicates({
        projectPath: tmpDir,
        consolidate: true,
        dryRun: true,
      });

      expect(dryResult.keysConsolidated).toBe(1);
      expect(dryResult.diff).toBeDefined();
      expect(dryResult.diff).toContain('t("auth.cancel_btn")');
      expect(dryResult.diff).toContain('t("common.cancel")');

      // Verify files not modified on disk
      const authBefore = JSON.parse(await fs.readFile(path.join(localesDir, "auth.json"), "utf8"));
      expect(authBefore.cancel_btn).toBe("Cancel");

      // 2. Apply to disk
      const writeResult = await auditDuplicates({
        projectPath: tmpDir,
        consolidate: true,
        dryRun: false,
      });

      expect(writeResult.keysConsolidated).toBe(1);

      // Verify redundant key removed from auth.json
      const authAfter = JSON.parse(await fs.readFile(path.join(localesDir, "auth.json"), "utf8"));
      expect(authAfter.cancel_btn).toBeUndefined();
      expect(authAfter.submit).toBe("Submit");

      // Verify source code call-site updated
      const codeAfter = await fs.readFile(compPath, "utf8");
      expect(codeAfter).toContain('t("common.cancel")');
    });

    it("should consolidate duplicates in Flutter ARB files", async () => {
      const pubspec = `
name: flutter_app
dependencies:
  flutter:
    sdk: flutter
`;
      await fs.writeFile(path.join(tmpDir, "pubspec.yaml"), pubspec, "utf8");

      const l10nDir = path.join(tmpDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });

      const appEn = {
        "@@locale": "en",
        cancel: "Cancel",
        dismissButton: "Cancel",
      };
      await fs.writeFile(path.join(l10nDir, "app_en.arb"), JSON.stringify(appEn, null, 2), "utf8");

      const result = await auditDuplicates({
        projectPath: tmpDir,
        consolidate: true,
        dryRun: false,
      });

      expect(result.keysConsolidated).toBe(1);

      const arbAfter = JSON.parse(await fs.readFile(path.join(l10nDir, "app_en.arb"), "utf8"));
      expect(arbAfter.cancel).toBe("Cancel");
      expect(arbAfter.dismissButton).toBeUndefined();
    });
  });
});
