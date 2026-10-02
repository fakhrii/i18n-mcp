import { describe, it, expect } from "vitest";
import {
  isCountIdentifier,
  singularizeEnglishWord,
  pluralizeEnglishWord,
  derivePluralForms,
} from "../../src/core/plural/plural-helper.js";
import { scanSourceFileAst } from "../../src/core/scanner/ast-scanner.js";
import { buildReplacementExpression } from "../../src/core/planning/source-change-planner.js";
import { prepareLocaleUpdates } from "../../src/core/replacement/locale-updater.js";
import type { TranslationPlan } from "../../src/models/plan.js";

describe("Pluralization Support", () => {
  describe("Plural Helper utilities", () => {
    it("correctly identifies count identifiers and property access expressions", () => {
      expect(isCountIdentifier("count")).toBe(true);
      expect(isCountIdentifier("total")).toBe(true);
      expect(isCountIdentifier("numItems")).toBe(true);
      expect(isCountIdentifier("itemCount")).toBe(true);
      expect(isCountIdentifier("unreadCount")).toBe(true);
      expect(isCountIdentifier("length", "items.length")).toBe(true);
      expect(isCountIdentifier("size", "queue.size")).toBe(true);

      expect(isCountIdentifier("name")).toBe(false);
      expect(isCountIdentifier("title")).toBe(false);
      expect(isCountIdentifier("seconds")).toBe(false);
    });

    it("singularizes English nouns properly", () => {
      expect(singularizeEnglishWord("items")).toBe("item");
      expect(singularizeEnglishWord("messages")).toBe("message");
      expect(singularizeEnglishWord("results")).toBe("result");
      expect(singularizeEnglishWord("categories")).toBe("category");
      expect(singularizeEnglishWord("boxes")).toBe("box");
      expect(singularizeEnglishWord("watches")).toBe("watch");
      expect(singularizeEnglishWord("children")).toBe("child");
      expect(singularizeEnglishWord("people")).toBe("person");
      expect(singularizeEnglishWord("status")).toBe("status"); // preserved
    });

    it("pluralizes English nouns properly", () => {
      expect(pluralizeEnglishWord("item")).toBe("items");
      expect(pluralizeEnglishWord("message")).toBe("messages");
      expect(pluralizeEnglishWord("category")).toBe("categories");
      expect(pluralizeEnglishWord("box")).toBe("boxes");
      expect(pluralizeEnglishWord("child")).toBe("children");
    });

    it("derives { one, other } plural forms from template phrases", () => {
      const p1 = derivePluralForms("{{count}} items", "count");
      expect(p1.one).toBe("{{count}} item");
      expect(p1.other).toBe("{{count}} items");

      const p2 = derivePluralForms("Found {{count}} results", "count");
      expect(p2.one).toBe("Found {{count}} result");
      expect(p2.other).toBe("Found {{count}} results");

      const p3 = derivePluralForms("{{count}} item", "count");
      expect(p3.one).toBe("{{count}} item");
      expect(p3.other).toBe("{{count}} items");
    });
  });

  describe("AST Scanner Plural Detection", () => {
    it("detects plural semantics in template literals with count variable", () => {
      const code = `
        export const ItemList = () => {
          return <Text>{\`\${count} items\`}</Text>;
        };
      `;

      const results = scanSourceFileAst({ filePath: "ItemList.tsx", sourceCode: code });
      expect(results).toHaveLength(1);
      const item = results[0]!;

      expect(item.isPlural).toBe(true);
      expect(item.pluralVariable).toBe("count");
      expect(item.pluralForm).toEqual({
        one: "{{count}} item",
        other: "{{count}} items",
      });
      expect(item.variableExpressions).toEqual({ count: "count" });
    });

    it("detects plural semantics in template literals with property access (items.length)", () => {
      const code = `
        export const Notifications = () => {
          return <Text>{\`\${items.length} unread messages\`}</Text>;
        };
      `;

      const results = scanSourceFileAst({ filePath: "Notifications.tsx", sourceCode: code });
      expect(results).toHaveLength(1);
      const item = results[0]!;

      expect(item.isPlural).toBe(true);
      expect(item.pluralVariable).toBe("count");
      expect(item.text).toBe("{{count}} unread messages");
      expect(item.pluralForm).toEqual({
        one: "{{count}} unread message",
        other: "{{count}} unread messages",
      });
      expect(item.variableExpressions).toEqual({ count: "items.length" });
    });

    it("detects conditional ternary expressions testing count equality", () => {
      const code = `
        export const CartBadge = () => {
          return <Text>{count === 1 ? '1 item' : \`\${count} items\`}</Text>;
        };
      `;

      const results = scanSourceFileAst({ filePath: "CartBadge.tsx", sourceCode: code });
      expect(results).toHaveLength(1);
      const item = results[0]!;

      expect(item.isPlural).toBe(true);
      expect(item.pluralVariable).toBe("count");
      expect(item.pluralForm).toEqual({
        one: "1 item",
        other: "{{count}} items",
      });
      expect(item.variableExpressions).toEqual({ count: "count" });
    });
  });

  describe("Source Change Planner & Locale Updater for Plurals", () => {
    it("builds replacement expression calling t('KEY', { count }) without _one suffix", () => {
      const code = `<Text>{\`\${count} items\`}</Text>;`;
      const [item] = scanSourceFileAst({ filePath: "Test.tsx", sourceCode: code });

      const fileCtx = {
        filePath: "Test.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["common"],
        accessPattern: "useTranslation" as const,
      };

      const replacement = buildReplacementExpression(item!, "common", "ITEMS", fileCtx);
      expect(replacement).toBe(`t("ITEMS", { count })`);
    });

    it("builds replacement expression calling t('KEY', { count: items.length })", () => {
      const code = `<Text>{\`\${items.length} items\`}</Text>;`;
      const [item] = scanSourceFileAst({ filePath: "Test.tsx", sourceCode: code });

      const fileCtx = {
        filePath: "Test.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["common"],
        accessPattern: "useTranslation" as const,
      };

      const replacement = buildReplacementExpression(item!, "common", "ITEMS", fileCtx);
      expect(replacement).toBe(`t("ITEMS", { count: items.length })`);
    });

    it("prepares locale updates generating _one and _other keys in locale JSON", async () => {
      const plan: TranslationPlan = {
        namespace: "common",
        key: "ITEMS",
        sourceText: "{{count}} items",
        action: "CREATE",
        matchType: "NONE",
        sourceLocale: {
          locale: "en",
          value: "{{count}} items",
          filePath: "locales/en/common.json",
        },
        targets: [],
        occurrences: 1,
        isPlural: true,
        pluralVariable: "count",
        pluralForm: {
          one: "{{count}} item",
          other: "{{count}} items",
        },
      };

      const result = await prepareLocaleUpdates("/mock/root", [plan]);
      expect(result.translationEntriesCreated).toBe(2);
      expect(result.stagedFiles.has("locales/en/common.json")).toBe(true);

      const stagedContent = JSON.parse(
        result.stagedFiles.get("locales/en/common.json")!
      );
      expect(stagedContent.ITEMS_one).toBe("{{count}} item");
      expect(stagedContent.ITEMS_other).toBe("{{count}} items");
    });
  });
});
