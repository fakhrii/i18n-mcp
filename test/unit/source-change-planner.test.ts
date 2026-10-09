import { describe, it, expect } from "vitest";
import {
  analyzeFileTranslationContext,
  buildReplacementExpression,
  determineRequiredCodeChanges,
  planSourceChange,
} from "../../src/core/planning/source-change-planner.js";
import type { DetectedString } from "../../src/models/scanner.js";

describe("Source Change Planner", () => {
  describe("analyzeFileTranslationContext", () => {
    it("detects useTranslation import and single bound namespace", () => {
      const code = `
        import React from "react";
        import { useTranslation } from "react-i18next";
        export function Screen() {
          const { t } = useTranslation("auth");
          return null;
        }
      `;
      const ctx = analyzeFileTranslationContext(code, "useTranslation");
      expect(ctx.hasUseTranslationImport).toBe(true);
      expect(ctx.boundNamespaces).toEqual(["auth"]);
      expect(ctx.accessPattern).toBe("useTranslation");
    });

    it("detects multiple bound namespaces", () => {
      const code = `
        import { useTranslation } from "react-i18next";
        const { t } = useTranslation(["common", "profile"]);
      `;
      const ctx = analyzeFileTranslationContext(code, "useTranslation");
      expect(ctx.boundNamespaces).toEqual(["common", "profile"]);
    });

    it("detects files with no i18n setup", () => {
      const code = `
        import React from "react";
        export function Screen() { return null; }
      `;
      const ctx = analyzeFileTranslationContext(code, "useTranslation");
      expect(ctx.hasUseTranslationImport).toBe(false);
      expect(ctx.boundNamespaces).toEqual([]);
    });
  });

  describe("buildReplacementExpression", () => {
    const fileCtxBoundAuth = {
      filePath: "src/Screen.tsx",
      hasUseTranslationImport: true,
      hasI18nImport: false,
      boundNamespaces: ["auth"],
      accessPattern: "useTranslation" as const,
    };

    it("formats JSX text within component bound to the same namespace", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 10,
        column: 5,
        text: "Welcome",
        rawText: '"Welcome"',
        type: "JSX_TEXT",
        classification: "UI_TEXT",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "auth",
        suggestedKey: "WELCOME",
        reason: "JSX Text",
      };

      const expr = buildReplacementExpression(item, "auth", "WELCOME", fileCtxBoundAuth);
      expect(expr).toBe('{t("WELCOME")}');
    });

    it("prefixes namespace when accessing a key outside bound namespace", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 10,
        column: 5,
        text: "Cancel",
        rawText: '"Cancel"',
        type: "JSX_TEXT",
        classification: "UI_TEXT",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "common",
        suggestedKey: "CANCEL",
        reason: "JSX Text",
      };

      const expr = buildReplacementExpression(item, "common", "CANCEL", fileCtxBoundAuth);
      expect(expr).toBe('{t("common:CANCEL")}');
    });

    it("formats JSX attribute replacements", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 15,
        column: 10,
        text: "Enter email",
        rawText: '"Enter email"',
        type: "JSX_ATTRIBUTE",
        classification: "PLACEHOLDER",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "auth",
        suggestedKey: "ENTER_EMAIL",
        reason: "Placeholder",
      };

      const expr = buildReplacementExpression(item, "auth", "ENTER_EMAIL", fileCtxBoundAuth);
      expect(expr).toBe('{t("ENTER_EMAIL")}');
    });

    it("formats template literals with interpolation variables", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 20,
        column: 10,
        text: "Hello {{name}}, you have {{count}} items",
        rawText: "`Hello ${name}, you have ${count} items`",
        type: "CALL_EXPRESSION",
        classification: "NOTIFICATION",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "auth",
        suggestedKey: "GREETING",
        reason: "Notification",
        variables: ["name", "count"],
      };

      const expr = buildReplacementExpression(item, "auth", "GREETING", fileCtxBoundAuth);
      expect(expr).toBe('t("GREETING", { name, count })');
    });

    it("correctly handles multi-namespace bound components (primary vs secondary)", () => {
      const fileCtxMultiNs = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["profile", "common"],
        accessPattern: "useTranslation" as const,
      };

      const primaryItem: DetectedString = {
        file: "src/Screen.tsx",
        line: 10,
        column: 5,
        text: "User Profile",
        rawText: '"User Profile"',
        type: "JSX_TEXT",
        classification: "UI_TEXT",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "profile",
        suggestedKey: "USER_PROFILE",
        reason: "JSX Text",
      };

      const secondaryItem: DetectedString = {
        file: "src/Screen.tsx",
        line: 20,
        column: 5,
        text: "Save",
        rawText: '"Save"',
        type: "JSX_TEXT",
        classification: "UI_TEXT",
        confidence: 0.95,
        confidenceLevel: "HIGH",
        suggestedNamespace: "common",
        suggestedKey: "SAVE",
        reason: "JSX Text",
      };

      // Primary namespace uses unprefixed key
      expect(buildReplacementExpression(primaryItem, "profile", "USER_PROFILE", fileCtxMultiNs)).toBe(
        '{t("USER_PROFILE")}'
      );
      // Secondary namespace uses namespace-prefixed key
      expect(buildReplacementExpression(secondaryItem, "common", "SAVE", fileCtxMultiNs)).toBe(
        '{t("common:SAVE")}'
      );
    });
  });

  describe("determineRequiredCodeChanges", () => {
    it("plans ADD_IMPORT and ADD_HOOK when missing", () => {
      const fileCtx = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: false,
        hasI18nImport: false,
        boundNamespaces: [],
        accessPattern: "useTranslation" as const,
      };

      const changes = determineRequiredCodeChanges(fileCtx, "auth");
      expect(changes).toHaveLength(2);
      expect(changes[0]).toEqual({
        type: "ADD_IMPORT",
        value: "useTranslation",
        module: "react-i18next",
      });
      expect(changes[1]).toEqual({
        type: "ADD_HOOK",
        value: 'const { t } = useTranslation("auth")',
      });
    });

    it("plans multi-namespace ADD_HOOK when multiple namespaces are required", () => {
      const fileCtx = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: false,
        hasI18nImport: false,
        boundNamespaces: [],
        accessPattern: "useTranslation" as const,
      };

      const changes = determineRequiredCodeChanges(fileCtx, ["profile", "common"]);
      expect(changes).toHaveLength(2);
      expect(changes[1]).toEqual({
        type: "ADD_HOOK",
        value: 'const { t } = useTranslation(["profile", "common"])',
      });
    });

    it("plans UPDATE_HOOK when an existing hook needs additional namespaces", () => {
      const fileCtx = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["profile"],
        accessPattern: "useTranslation" as const,
      };

      const changes = determineRequiredCodeChanges(fileCtx, ["profile", "common"]);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({
        type: "UPDATE_HOOK",
        value: 'const { t } = useTranslation(["profile", "common"])',
      });
    });

    it("plans nothing if import and hook already exist", () => {
      const fileCtx = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["auth"],
        accessPattern: "useTranslation" as const,
      };

      const changes = determineRequiredCodeChanges(fileCtx, "auth");
      expect(changes).toHaveLength(0);
    });

    it("plans nothing if multi-namespace hook already has all namespaces", () => {
      const fileCtx = {
        filePath: "src/Screen.tsx",
        hasUseTranslationImport: true,
        hasI18nImport: false,
        boundNamespaces: ["profile", "common"],
        accessPattern: "useTranslation" as const,
      };

      const changes = determineRequiredCodeChanges(fileCtx, ["profile", "common"]);
      expect(changes).toHaveLength(0);
    });
  });

  describe("planSourceChange", () => {
    const fileCtx = {
      filePath: "src/Screen.tsx",
      hasUseTranslationImport: true,
      hasI18nImport: false,
      boundNamespaces: ["auth"],
      accessPattern: "useTranslation" as const,
    };

    it("plans REPLACE for high-confidence strings", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 12,
        column: 5,
        text: "Welcome back",
        rawText: '"Welcome back"',
        type: "JSX_TEXT",
        classification: "UI_TEXT",
        confidence: 0.98,
        confidenceLevel: "HIGH",
        suggestedNamespace: "auth",
        suggestedKey: "WELCOME_BACK",
        reason: "JSX Text",
      };

      const plan = planSourceChange(item, "auth", "WELCOME_BACK", fileCtx);
      expect(plan.action).toBe("REPLACE");
      expect(plan.status).toBe("SUPPORTED");
      expect(plan.replacement).toBe('{t("WELCOME_BACK")}');
    });

    it("plans REVIEW for low-confidence ambiguous strings", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 18,
        column: 5,
        text: "Open",
        rawText: '"Open"',
        type: "STRING_LITERAL",
        classification: "UNKNOWN",
        confidence: 0.45,
        confidenceLevel: "LOW",
        suggestedNamespace: "common",
        suggestedKey: "OPEN",
        reason: "Unknown string context",
      };

      const plan = planSourceChange(item, "common", "OPEN", fileCtx, {
        confidenceThreshold: 0.7,
      });
      expect(plan.action).toBe("REVIEW");
      expect(plan.reason).toContain("Ambiguous");
    });

    it("flags UNSUPPORTED for dynamic string construction", () => {
      const item: DetectedString = {
        file: "src/Screen.tsx",
        line: 25,
        column: 5,
        text: "Hello " + "world",
        rawText: '"Hello " + userName',
        type: "CALL_EXPRESSION",
        classification: "USER_FACING",
        confidence: 0.85,
        confidenceLevel: "HIGH",
        suggestedNamespace: "auth",
        suggestedKey: "HELLO",
        reason: "Call expression",
      };

      const plan = planSourceChange(item, "auth", "HELLO", fileCtx);
      expect(plan.action).toBe("REVIEW");
      expect(plan.status).toBe("UNSUPPORTED");
      expect(plan.reason).toContain("Dynamic string construction");
    });
  });
});
