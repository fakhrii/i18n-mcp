import { describe, it, expect } from "vitest";
import {
  extractReferencedKeysFromSource,
  isKeyReferenced,
  detectDeadKeys,
  pruneUnusedKeys,
} from "../../src/core/validation/dead-key-detector.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("Phase P3: Dead / Unused Key Pruning & Audit", () => {
  it("extracts translation key references from various frontend syntax patterns", () => {
    const code = `
      import { useTranslation, Trans } from "react-i18next";

      export const Header = () => {
        const { t } = useTranslation("common");
        return (
          <div>
            <h1>{t("WELCOME_TITLE")}</h1>
            <button>{t("auth:LOGIN_BUTTON")}</button>
            <p>{i18n.t("FOOTER_DISCLAIMER")}</p>
            <Trans i18nKey="TERMS_PROMPT" />
          </div>
        );
      };
    `;

    const keys = extractReferencedKeysFromSource(code);
    expect(keys.has("WELCOME_TITLE")).toBe(true);
    expect(keys.has("LOGIN_BUTTON")).toBe(true);
    expect(keys.has("FOOTER_DISCLAIMER")).toBe(true);
    expect(keys.has("TERMS_PROMPT")).toBe(true);
    expect(keys.has("UNREFERENCED_KEY")).toBe(false);
  });

  it("extracts Flutter l10n key references from Dart code", () => {
    const code = `
      final text1 = Text(l10n.welcomeMessage);
      final text2 = Text(AppLocalizations.of(context)!.dashboardTitle);
    `;

    const keys = extractReferencedKeysFromSource(code);
    expect(keys.has("welcomeMessage")).toBe(true);
    expect(keys.has("dashboardTitle")).toBe(true);
    expect(keys.has("deadKey")).toBe(false);
  });

  it("treats plural suffixes (_one, _other) as referenced when the base key is called", () => {
    const referenced = new Set(["ITEMS", "CART_COUNT"]);
    expect(isKeyReferenced("ITEMS_one", referenced)).toBe(true);
    expect(isKeyReferenced("ITEMS_other", referenced)).toBe(true);
    expect(isKeyReferenced("CART_COUNT_zero", referenced)).toBe(true);
    expect(isKeyReferenced("ORPHAN_one", referenced)).toBe(false);
  });

  it("detects unused dead keys when comparing against source translations", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dead-keys-test-"));
    const srcFile = path.join(tempDir, "Screen.tsx");
    await fs.writeFile(
      srcFile,
      `export const S = () => <div>{t("USED_KEY")}</div>;`,
      "utf8"
    );

    const sourceTranslations = new Map<string, Map<string, string>>([
      [
        "common",
        new Map([
          ["USED_KEY", "This is used"],
          ["DEAD_KEY_1", "This is never referenced"],
          ["DEAD_KEY_2", "This is also dead"],
        ]),
      ],
    ]);

    const result = await detectDeadKeys({
      projectRoot: tempDir,
      sourceFiles: ["Screen.tsx"],
      sourceTranslations,
    });

    expect(result.totalKeysCount).toBe(3);
    expect(result.usedKeysCount).toBe(1);
    expect(result.unusedKeys).toHaveLength(2);
    expect(result.unusedKeys.map((u) => u.key)).toEqual(["DEAD_KEY_1", "DEAD_KEY_2"]);

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prunes unused keys from JSON locale files on disk", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dead-prune-test-"));
    const localesDir = path.join(tempDir, "locales");
    await fs.mkdir(localesDir);

    const jsonPath = path.join(localesDir, "common.json");
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          KEEP_ME: "Val 1",
          DELETE_ME: "Val 2",
        },
        null,
        2
      ),
      "utf8"
    );

    const prunedCount = await pruneUnusedKeys({
      projectRoot: tempDir,
      localeDirectory: "locales",
      unusedKeys: [{ namespace: "common", key: "DELETE_ME" }],
    });

    expect(prunedCount).toBe(1);
    const updatedContent = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    expect(updatedContent.KEEP_ME).toBe("Val 1");
    expect(updatedContent.DELETE_ME).toBeUndefined();

    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
