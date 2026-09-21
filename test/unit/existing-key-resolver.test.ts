import { describe, it, expect } from "vitest";
import {
  normalizeText,
  computeSemanticSimilarity,
  resolveExistingTranslation,
  type ExistingTranslations,
  type ExistingTranslationItem,
} from "../../src/core/planning/existing-key-resolver.js";

describe("Existing Key Resolver", () => {
  describe("normalizeText", () => {
    it("lowercases, strips quotes, whitespace and edge punctuation", () => {
      expect(normalizeText('  "Cancel..."  ')).toBe("cancel");
      expect(normalizeText("Save!")).toBe("save");
      expect(normalizeText("Enter your email:")).toBe("enter your email");
      expect(normalizeText("  Loading…  ")).toBe("loading");
    });
  });

  describe("computeSemanticSimilarity", () => {
    it("returns 1.0 for identical normalized text", () => {
      expect(computeSemanticSimilarity("Cancel", "cancel")).toBe(1.0);
    });

    it("returns high score for minor stop-word variations", () => {
      const score = computeSemanticSimilarity(
        "Enter your email",
        "Enter email"
      );
      expect(score).toBeGreaterThanOrEqual(0.85);
    });

    it("returns low score for semantically distinct phrases", () => {
      const score = computeSemanticSimilarity(
        "Open account",
        "Open"
      );
      expect(score).toBeLessThan(0.85);
    });
  });

  describe("resolveExistingTranslation", () => {
    const mockCommonItems: ExistingTranslationItem[] = [
      {
        namespace: "common",
        key: "CANCEL",
        value: "Cancel",
        normalizedValue: "cancel",
        sourceFile: "locales/en/common.json",
      },
      {
        namespace: "common",
        key: "SAVE",
        value: "Save",
        normalizedValue: "save",
        sourceFile: "locales/en/common.json",
      },
      {
        namespace: "common",
        key: "LOADING",
        value: "Loading...",
        normalizedValue: "loading",
        sourceFile: "locales/en/common.json",
      },
    ];

    const mockAuthItems: ExistingTranslationItem[] = [
      {
        namespace: "auth",
        key: "LOGIN",
        value: "Log in",
        normalizedValue: "log in",
        sourceFile: "locales/en/auth.json",
      },
      {
        namespace: "auth",
        key: "FORGOT_PASSWORD",
        value: "Forgot password?",
        normalizedValue: "forgot password",
        sourceFile: "locales/en/auth.json",
      },
      {
        namespace: "auth",
        key: "ENTER_EMAIL",
        value: "Enter email",
        normalizedValue: "enter email",
        sourceFile: "locales/en/auth.json",
      },
    ];

    const allItems = [...mockCommonItems, ...mockAuthItems];
    const byNamespace = new Map<string, Map<string, string>>([
      [
        "common",
        new Map([
          ["CANCEL", "Cancel"],
          ["SAVE", "Save"],
          ["LOADING", "Loading..."],
        ]),
      ],
      [
        "auth",
        new Map([
          ["LOGIN", "Log in"],
          ["FORGOT_PASSWORD", "Forgot password?"],
          ["ENTER_EMAIL", "Enter email"],
        ]),
      ],
    ]);

    const existing: ExistingTranslations = {
      items: allItems,
      byNamespace,
      commonItems: mockCommonItems,
    };

    it("reuses exact match in common namespace first", () => {
      const result = resolveExistingTranslation("Cancel", "checkout", existing);
      expect(result.action).toBe("REUSE");
      expect(result.matchType).toBe("EXACT");
      expect(result.namespace).toBe("common");
      expect(result.key).toBe("CANCEL");
      expect(result.confidence).toBe(1.0);
    });

    it("reuses normalized match (punctuation & case differences)", () => {
      const result = resolveExistingTranslation("cancel...", "checkout", existing);
      expect(result.action).toBe("REUSE");
      expect(result.matchType).toBe("NORMALIZED");
      expect(result.namespace).toBe("common");
      expect(result.key).toBe("CANCEL");
      expect(result.confidence).toBe(0.95);
    });

    it("reuses exact match in preferred feature namespace", () => {
      const result = resolveExistingTranslation("Forgot password?", "auth", existing);
      expect(result.action).toBe("REUSE");
      expect(result.matchType).toBe("EXACT");
      expect(result.namespace).toBe("auth");
      expect(result.key).toBe("FORGOT_PASSWORD");
    });

    it("conservatively matches semantic variations above threshold (>= 0.85)", () => {
      const result = resolveExistingTranslation(
        "Enter your email",
        "auth",
        existing,
        0.85
      );
      expect(result.action).toBe("REUSE");
      expect(result.matchType).toBe("SEMANTIC");
      expect(result.namespace).toBe("auth");
      expect(result.key).toBe("ENTER_EMAIL");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("does not merge uncertain strings below threshold and creates new key", () => {
      const result = resolveExistingTranslation(
        "Enter your registered email address and phone",
        "auth",
        existing,
        0.85
      );
      expect(result.action).toBe("CREATE");
      expect(result.matchType).toBe("NONE");
    });

    it("returns CREATE when no existing translation matches", () => {
      const result = resolveExistingTranslation(
        "Welcome to our premium subscription",
        "billing",
        existing
      );
      expect(result.action).toBe("CREATE");
      expect(result.matchType).toBe("NONE");
    });
  });
});
