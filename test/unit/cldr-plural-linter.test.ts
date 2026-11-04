import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRequiredPluralCategories,
  isValidPluralSelector,
} from "../../src/core/plural/cldr-rules.js";
import {
  parseIcuClauses,
  serializeIcuClause,
  injectMissingIcuBranches,
} from "../../src/core/plural/icu-parser.js";
import { auditPlurals } from "../../src/core/plural/cldr-linter.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Unicode CLDR Plural & Gender Rules Linter", () => {
  describe("CLDR Rules Mapping", () => {
    it("should return correct categories for Western languages", () => {
      expect(getRequiredPluralCategories("en")).toEqual(["one", "other"]);
      expect(getRequiredPluralCategories("de")).toEqual(["one", "other"]);
      expect(getRequiredPluralCategories("es")).toEqual(["one", "many", "other"]);
    });

    it("should return correct categories for 6-form Arabic (ar)", () => {
      const arCategories = getRequiredPluralCategories("ar");
      expect(arCategories).toEqual(["zero", "one", "two", "few", "many", "other"]);
    });

    it("should return correct categories for 4-form Slavic languages (ru, pl, uk)", () => {
      expect(getRequiredPluralCategories("ru")).toEqual(["one", "few", "many", "other"]);
      expect(getRequiredPluralCategories("pl")).toEqual(["one", "few", "many", "other"]);
      expect(getRequiredPluralCategories("uk")).toEqual(["one", "few", "many", "other"]);
    });

    it("should return correct categories for 1-form languages (ja, zh, ko)", () => {
      expect(getRequiredPluralCategories("ja")).toEqual(["other"]);
      expect(getRequiredPluralCategories("zh")).toEqual(["other"]);
      expect(getRequiredPluralCategories("ko")).toEqual(["other"]);
    });

    it("should validate plural selectors properly", () => {
      expect(isValidPluralSelector("zero")).toBe(true);
      expect(isValidPluralSelector("one")).toBe(true);
      expect(isValidPluralSelector("few")).toBe(true);
      expect(isValidPluralSelector("=0")).toBe(true);
      expect(isValidPluralSelector("=42")).toBe(true);
      expect(isValidPluralSelector("invalid_cat")).toBe(false);
    });
  });

  describe("ICU MessageFormat Parser", () => {
    it("should parse simple ICU plural clauses", () => {
      const text = "{count, plural, =0{No items} one{1 item} other{# items}}";
      const clauses = parseIcuClauses(text);

      expect(clauses).toHaveLength(1);
      const c = clauses[0]!;
      expect(c.variable).toBe("count");
      expect(c.type).toBe("plural");
      expect(c.branches).toHaveLength(3);
      expect(c.branches[0]).toEqual({ selector: "=0", content: "No items" });
      expect(c.branches[1]).toEqual({ selector: "one", content: "1 item" });
      expect(c.branches[2]).toEqual({ selector: "other", content: "# items" });
    });

    it("should handle nested interpolation braces within branch content", () => {
      const text = "You have {unread, plural, one{one {itemType}} other{{unread} {itemType}s}} pending.";
      const clauses = parseIcuClauses(text);

      expect(clauses).toHaveLength(1);
      const c = clauses[0]!;
      expect(c.variable).toBe("unread");
      expect(c.branches[0]?.content).toBe("one {itemType}");
      expect(c.branches[1]?.content).toBe("{unread} {itemType}s");
    });

    it("should parse offset parameter in ICU plurals", () => {
      const text = "{count, plural, offset:1 =0{Nobody} =1{You} one{You and one guest} other{You and # guests}}";
      const clauses = parseIcuClauses(text);

      expect(clauses).toHaveLength(1);
      const c = clauses[0]!;
      expect(c.offset).toBe(1);
      expect(c.branches).toHaveLength(4);
    });

    it("should serialize and inject missing branches using template", () => {
      const text = "{count, plural, one{1 item} other{# items}}";
      const clause = parseIcuClauses(text)[0]!;
      const injected = injectMissingIcuBranches(text, clause, ["few", "many"]);

      expect(injected).toContain("few{# items}");
      expect(injected).toContain("many{# items}");
      expect(injected).toContain("one{1 item}");
      expect(injected).toContain("other{# items}");
    });
  });

  describe("auditPlurals End-to-End Engine", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cldr-audit-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should detect missing mandatory 'other' branch in ICU plural", async () => {
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });

      // Missing 'other'
      const enJson = {
        cart: "{count, plural, =0{Empty} one{1 item}}",
      };
      await fs.writeFile(path.join(localesDir, "en.json"), JSON.stringify(enJson, null, 2), "utf8");

      const result = await auditPlurals({
        projectPath: tempDir,
      });

      expect(result.totalIssues).toBeGreaterThan(0);
      expect(result.missingOtherFallbackCount).toBe(1);
      const otherIssue = result.issues.find((i) => i.issueType === "MISSING_OTHER_FALLBACK");
      expect(otherIssue).toBeDefined();
      expect(otherIssue?.severity).toBe("error");
    });

    it("should detect missing CLDR plural categories in Arabic ARB catalog and auto-scaffold them with fix=true", async () => {
      const l10nDir = path.join(tempDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });

      // Arabic ARB only has 'one' and 'other' (missing zero, two, few, many)
      const arArb = {
        "@@locale": "ar",
        "notificationsCount": "{count, plural, one{إشعار واحد} other{{count} إشعارات}}",
      };
      await fs.writeFile(path.join(l10nDir, "app_ar.arb"), JSON.stringify(arArb, null, 2), "utf8");

      // 1. Audit in preview mode
      const auditResult = await auditPlurals({
        projectPath: tempDir,
        locales: ["ar"],
      });

      expect(auditResult.totalIssues).toBeGreaterThan(0);
      const cldrIssue = auditResult.issues.find((i) => i.issueType === "MISSING_REQUIRED_PLURAL");
      expect(cldrIssue).toBeDefined();
      expect(cldrIssue?.missingCategories).toEqual(["zero", "two", "few", "many"]);

      // 2. Run with fix=true and dryRun=false
      const fixResult = await auditPlurals({
        projectPath: tempDir,
        locales: ["ar"],
        fix: true,
        dryRun: false,
      });

      expect(fixResult.fixesApplied).toBe(1);
      expect(fixResult.filesModified).toHaveLength(1);
      expect(fixResult.diff).toContain("+");

      // Read back updated file
      const updatedArb = JSON.parse(await fs.readFile(path.join(l10nDir, "app_ar.arb"), "utf8"));
      const updatedVal = updatedArb.notificationsCount;
      expect(updatedVal).toContain("zero{");
      expect(updatedVal).toContain("two{");
      expect(updatedVal).toContain("few{");
      expect(updatedVal).toContain("many{");
    });

    it("should detect and scaffold missing i18next plural keys in Russian JSON catalog", async () => {
      const localesDir = path.join(tempDir, "locales");
      await fs.mkdir(localesDir, { recursive: true });

      // Russian requires one, few, many, other.
      // Providing only item_one and item_other -> missing item_few and item_many
      const ruJson = {
        common: {
          item_one: "1 яблоко",
          item_other: "{{count}} яблок",
        },
      };
      await fs.writeFile(path.join(localesDir, "ru.json"), JSON.stringify(ruJson, null, 2), "utf8");

      const auditResult = await auditPlurals({
        projectPath: tempDir,
        locales: ["ru"],
      });

      expect(auditResult.totalIssues).toBe(1);
      const issue = auditResult.issues[0]!;
      expect(issue.format).toBe("I18NEXT_SUFFIX");
      expect(issue.missingCategories).toEqual(["few", "many"]);

      // Auto-fix
      const fixResult = await auditPlurals({
        projectPath: tempDir,
        locales: ["ru"],
        fix: true,
        dryRun: false,
      });

      expect(fixResult.fixesApplied).toBe(2);

      const updatedRu = JSON.parse(await fs.readFile(path.join(localesDir, "ru.json"), "utf8"));
      expect(updatedRu.common.item_few).toBe("{{count}} яблок");
      expect(updatedRu.common.item_many).toBe("{{count}} яблок");
    });
  });
});
