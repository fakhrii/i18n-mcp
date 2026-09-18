import { describe, it, expect } from "vitest";
import {
  applySourceChangesToFile,
  injectRequiredImports,
  injectRequiredHooks,
} from "../../src/core/replacement/ast-transformer.js";
import type { SourceChangePlan } from "../../src/models/plan.js";

describe("AST Transformer", () => {
  describe("injectRequiredImports", () => {
    it("adds useTranslation to existing react-i18next import", () => {
      const original = 'import React from "react";\nimport { Trans } from "react-i18next";\n';
      const result = injectRequiredImports(original, [
        { type: "ADD_IMPORT", value: "useTranslation", module: "react-i18next" },
      ]);
      expect(result).toContain('import { Trans, useTranslation } from "react-i18next";');
    });

    it("adds new react-i18next import if none exists", () => {
      const original = 'import React from "react";\nimport { View } from "react-native";\n';
      const result = injectRequiredImports(original, [
        { type: "ADD_IMPORT", value: "useTranslation", module: "react-i18next" },
      ]);
      expect(result).toContain('import { useTranslation } from "react-i18next";');
    });

    it("does not duplicate useTranslation if already imported", () => {
      const original = 'import { useTranslation } from "react-i18next";\n';
      const result = injectRequiredImports(original, [
        { type: "ADD_IMPORT", value: "useTranslation", module: "react-i18next" },
      ]);
      expect(result).toBe(original);
    });
  });

  describe("injectRequiredHooks", () => {
    it("injects hook into top-level functional component body", () => {
      const code = `
export function ProfileScreen() {
  const [data, setData] = useState(null);
  return <View />;
}
`;
      const res = injectRequiredHooks(code, "src/ProfileScreen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("profile")' },
      ]);

      expect(res.errors).toHaveLength(0);
      expect(res.updatedText).toContain('const { t } = useTranslation("profile");');
    });

    it("skips hook injection if useTranslation is already present", () => {
      const code = `
export function ProfileScreen() {
  const { t } = useTranslation("profile");
  return <View />;
}
`;
      const res = injectRequiredHooks(code, "src/ProfileScreen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("profile")' },
      ]);

      expect(res.updatedText).toBe(code);
    });
  });

  describe("applySourceChangesToFile", () => {
    it("replaces JSX text and attributes at exact source ranges", () => {
      const original = [
        'import React from "react";',
        'import { Text, TextInput } from "react-native";',
        'import { useTranslation } from "react-i18next";',
        '',
        'export function Screen() {',
        '  const { t } = useTranslation("auth");',
        '  return (',
        '    <>',
        '      <Text>Welcome back</Text>',
        '      <TextInput placeholder="Enter your email" />',
        '    </>',
        '  );',
        '}',
      ].join("\n");

      const sourceChanges: SourceChangePlan[] = [
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: {
            line: 9,
            column: 13,
            endLine: 9,
            endColumn: 25,
          },
          source: "Welcome back",
          replacement: '{t("WELCOME_BACK")}',
          namespace: "auth",
          key: "WELCOME_BACK",
        },
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: {
            line: 10,
            column: 30,
            endLine: 10,
            endColumn: 48,
          },
          source: '"Enter your email"',
          replacement: '{t("ENTER_YOUR_EMAIL")}',
          namespace: "auth",
          key: "ENTER_YOUR_EMAIL",
        },
      ];

      const res = applySourceChangesToFile("src/Screen.tsx", original, sourceChanges);

      expect(res.errors).toHaveLength(0);
      expect(res.changesApplied).toBe(2);
      expect(res.transformedContent).toContain('<Text>{t("WELCOME_BACK")}</Text>');
      expect(res.transformedContent).toContain(
        '<TextInput placeholder={t("ENTER_YOUR_EMAIL")} />'
      );
    });

    it("detects PLAN_STALE when source code has changed since plan generation", () => {
      const original = [
        'export function Screen() {',
        '  return <Text>Welcome modified</Text>;',
        '}',
      ].join("\n");

      const sourceChanges: SourceChangePlan[] = [
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: {
            line: 2,
            column: 16,
            endLine: 2,
            endColumn: 28,
          },
          source: "Welcome back",
          replacement: '{t("WELCOME_BACK")}',
          namespace: "auth",
          key: "WELCOME_BACK",
        },
      ];

      const res = applySourceChangesToFile("src/Screen.tsx", original, sourceChanges);

      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors[0]?.code).toBe("PLAN_STALE");
      expect(res.changesApplied).toBe(0);
    });
  });
});
