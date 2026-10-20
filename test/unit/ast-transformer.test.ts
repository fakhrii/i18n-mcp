import { describe, it, expect } from "vitest";
import {
  applySourceChangesToFile,
  injectRequiredImports,
  injectRequiredHooks,
  ensureI18nIntegrity,
  stripInvalidDartConst,
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

    it("updates existing single namespace hook to multi-namespace hook", () => {
      const code = `
export function ProfileScreen() {
  const { t } = useTranslation("profile");
  return <View />;
}
`;
      const res = injectRequiredHooks(code, "src/ProfileScreen.tsx", [
        {
          type: "UPDATE_HOOK",
          value: 'const { t } = useTranslation(["profile", "common"])',
        },
      ]);

      expect(res.updatedText).toContain('useTranslation(["profile", "common"])');
      expect(res.updatedText).not.toContain('useTranslation("profile")');
    });

    it("injects multi-namespace hook when no hook exists", () => {
      const code = `
export function ProfileScreen() {
  return <View />;
}
`;
      const res = injectRequiredHooks(code, "src/ProfileScreen.tsx", [
        {
          type: "ADD_HOOK",
          value: 'const { t } = useTranslation(["profile", "common"])',
        },
      ]);

      expect(res.updatedText).toContain('const { t } = useTranslation(["profile", "common"]);');
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

    it("guarantees import and hook injection in multi-component file", () => {
      const original = [
        'import React from "react";',
        'import { Text, View } from "react-native";',
        '',
        'const Header = () => {',
        '  return <Text>Header Title</Text>;',
        '};',
        '',
        'export default function MainScreen() {',
        '  return (',
        '    <View>',
        '      <Header />',
        '      <Text>Main Body</Text>',
        '    </View>',
        '  );',
        '}',
      ].join("\n");

      const sourceChanges: SourceChangePlan[] = [
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: { line: 5, column: 16, endLine: 5, endColumn: 28 },
          source: "Header Title",
          replacement: '{t("header_title")}',
          namespace: "common",
          key: "header_title",
        },
        {
          action: "REPLACE",
          file: "src/Screen.tsx",
          location: { line: 12, column: 13, endLine: 12, endColumn: 22 },
          source: "Main Body",
          replacement: '{t("main_body")}',
          namespace: "common",
          key: "main_body",
        },
      ];

      const res = applySourceChangesToFile("src/Screen.tsx", original, sourceChanges);

      expect(res.errors).toHaveLength(0);
      expect(res.transformedContent).toContain('import { useTranslation } from "react-i18next";');
      // Both components must have t declared!
      const lines = res.transformedContent.split("\n");
      const hookCount = lines.filter((l) => l.includes('useTranslation("common")')).length;
      expect(hookCount).toBe(2);
      expect(res.transformedContent).toContain('{t("header_title")}');
      expect(res.transformedContent).toContain('{t("main_body")}');
    });
  });

  describe("HOCs, Anonymous Exports, Multi-line imports, and Edge Cases", () => {
    it("handles multi-line import statements and places new import cleanly after them", () => {
      const original = [
        'import React, {',
        '  useState,',
        '  useEffect,',
        '} from "react";',
        'import {',
        '  View,',
        '  Text,',
        '  StyleSheet,',
        '} from "react-native";',
        '',
        'export function App() { return <View />; }',
      ].join("\n");

      const result = injectRequiredImports(original, [
        { type: "ADD_IMPORT", value: "useTranslation", module: "react-i18next" },
      ]);

      expect(result).toContain('import { useTranslation } from "react-i18next";');
      // Must be inserted after the last import, not at index 0
      const useTranslationIndex = result.indexOf('import { useTranslation } from "react-i18next";');
      const reactNativeImportIndex = result.indexOf('from "react-native";');
      expect(useTranslationIndex).toBeGreaterThan(reactNativeImportIndex);
    });

    it("places import after 'use client' directive when no imports exist", () => {
      const original = '"use client";\n\nexport function Component() { return <div />; }\n';
      const result = injectRequiredImports(original, [
        { type: "ADD_IMPORT", value: "useTranslation", module: "react-i18next" },
      ]);

      expect(result.startsWith('"use client";')).toBe(true);
      expect(result).toContain('import { useTranslation } from "react-i18next";');
    });

    it("injects hook into anonymous default export function", () => {
      const code = `
export default function(props: any) {
  return <Text>{t("hello")}</Text>;
}
`;
      const res = injectRequiredHooks(code, "src/Screen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("common")' },
      ]);

      expect(res.errors).toHaveLength(0);
      expect(res.updatedText).toContain('const { t } = useTranslation("common");');
    });

    it("blockifies and injects hook into export default arrow function", () => {
      const code = 'export default () => <Text>{t("hello")}</Text>;\n';
      const res = injectRequiredHooks(code, "src/Screen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("common")' },
      ]);

      expect(res.errors).toHaveLength(0);
      expect(res.updatedText).toContain('const { t } = useTranslation("common");');
      expect(res.updatedText).toContain('return <Text>{t("hello")}</Text>;');
    });

    it("unwraps React.memo and injects hook into concise arrow function body", () => {
      const code = `
export const MemoScreen = React.memo(() => (
  <View>
    <Text>{t("title")}</Text>
  </View>
));
`;
      const res = injectRequiredHooks(code, "src/Screen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("common")' },
      ]);

      expect(res.errors).toHaveLength(0);
      expect(res.updatedText).toContain('const { t } = useTranslation("common");');
      expect(res.updatedText).toContain('return (');
    });

    it("unwraps forwardRef and injects hook", () => {
      const code = `
export const CustomInput = forwardRef((props: any, ref: any) => {
  return <TextInput placeholder={t("hint")} />;
});
`;
      const res = injectRequiredHooks(code, "src/Screen.tsx", [
        { type: "ADD_HOOK", value: 'const { t } = useTranslation("common")' },
      ]);

      expect(res.errors).toHaveLength(0);
      expect(res.updatedText).toContain('const { t } = useTranslation("common");');
    });
  });

  describe("ensureI18nIntegrity safety net", () => {
    it("guarantees useTranslation import and declaration when t(...) is used but missing imports/declarations", () => {
      const code = [
        'import React from "react";',
        'import { Text, View } from "react-native";',
        '',
        'export function Screen() {',
        '  return <Text>{t("welcome")}</Text>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/Screen.tsx", "profile");

      expect(result).toContain('import { useTranslation } from "react-i18next";');
      expect(result).toContain('const { t } = useTranslation("profile");');
    });

    it("guarantees Trans import when <Trans> is used", () => {
      const code = [
        'import React from "react";',
        'import { Text } from "react-native";',
        '',
        'export function Screen() {',
        '  return <Trans i18nKey="hello">Hello</Trans>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/Screen.tsx", "common");

      expect(result).toContain('import { Trans } from "react-i18next";');
    });

    it("guarantees i18n import when i18n.t(...) is used", () => {
      const code = [
        'export function getTitle() {',
        '  return i18n.t("app.title");',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/utils.ts", "common");

      expect(result).toContain('import i18n from "i18next";');
    });

    it("leaves already correct files completely untouched", () => {
      const code = [
        'import React from "react";',
        'import { useTranslation } from "react-i18next";',
        '',
        'export function Screen() {',
        '  const { t } = useTranslation("profile");',
        '  return <Text>{t("welcome")}</Text>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/Screen.tsx", "profile");

      expect(result).toBe(code);
    });

    it("respects next-intl files and does not inject react-i18next", () => {
      const code = [
        "'use client';",
        'import React from "react";',
        'import { useTranslations } from "next-intl";',
        '',
        'export default function HomePage() {',
        '  const t = useTranslations();',
        '  return <h1>{t("welcome")}</h1>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/app/page.tsx", "common", "next-intl");

      expect(result).not.toContain("react-i18next");
      expect(result).toContain('import { useTranslations } from "next-intl";');
      expect(result).toContain("const t = useTranslations();");
    });

    it("auto-detects next-intl from useTranslations and injects next-intl when missing", () => {
      const code = [
        "'use client';",
        'import React from "react";',
        '',
        'export default function HomePage() {',
        '  return <h1>{t("welcome")}</h1>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "src/app/page.tsx", "common", "next-intl");

      expect(result).not.toContain("react-i18next");
      expect(result).toContain('import { useTranslations } from "next-intl";');
      expect(result).toContain("const t = useTranslations();");
    });

    it("respects next-i18next and injects useTranslation from next-i18next", () => {
      const code = [
        'import React from "react";',
        '',
        'export default function HomePage() {',
        '  return <h1>{t("welcome")}</h1>;',
        '}',
      ].join("\n");

      const result = ensureI18nIntegrity(code, "pages/index.tsx", "common", "next-i18next");

      expect(result).not.toContain('from "react-i18next"');
      expect(result).toContain('import { useTranslation } from "next-i18next";');
      expect(result).toContain('const { t } = useTranslation("common");');
    });
  });

  describe("stripInvalidDartConst for Flutter", () => {
    it("strips const from outer widget when nested child uses AppLocalizations.of(context)", () => {
      const code = [
        "Widget build(BuildContext context) {",
        "  return const Center(",
        "    child: Column(",
        "      children: [",
        "        Text(AppLocalizations.of(context)!.welcome),",
        "      ],",
        "    ),",
        "  );",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(code);
      expect(result).not.toContain("const Center");
      expect(result).toContain("return Center(");
    });

    it("strips const from const list literals containing AppLocalizations.of(context)", () => {
      const code = [
        "Widget build(BuildContext context) {",
        "  return Column(",
        "    children: const [",
        "      Text(AppLocalizations.of(context)!.welcome),",
        "    ],",
        "  );",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(code);
      expect(result).not.toContain("const [");
      expect(result).toContain("children: [");
    });

    it("preserves sibling const widgets that do not use AppLocalizations", () => {
      const code = [
        "Widget build(BuildContext context) {",
        "  return Column(",
        "    children: [",
        "      Text(AppLocalizations.of(context)!.welcome),",
        "      const SizedBox(height: 16),",
        "      const Divider(),",
        "    ],",
        "  );",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(code);
      expect(result).toContain("const SizedBox(height: 16)");
      expect(result).toContain("const Divider()");
    });

    it("works end-to-end via applySourceChangesToFile on a .dart file", () => {
      const originalDart = [
        "import 'package:flutter/material.dart';",
        "",
        "class MyWidget extends StatelessWidget {",
        "  @override",
        "  Widget build(BuildContext context) {",
        "    return const Center(",
        "      child: Text('Hello Flutter'),",
        "    );",
        "  }",
        "}",
      ].join("\n");

      const changes: SourceChangePlan[] = [
        {
          action: "REPLACE",
          file: "lib/widget.dart",
          location: { line: 7, column: 19, endLine: 7, endColumn: 34 },
          source: "'Hello Flutter'",
          replacement: "AppLocalizations.of(context)!.helloFlutter",
          namespace: "common",
          key: "helloFlutter",
          requiredCodeChanges: [
            {
              type: "ADD_IMPORT",
              module: "package:flutter_gen/gen_l10n/app_localizations.dart",
              value: "AppLocalizations",
            },
          ],
        },
      ];

      const res = applySourceChangesToFile("lib/widget.dart", originalDart, changes);
      expect(res.errors).toHaveLength(0);
      expect(res.transformedContent).toContain("import 'package:flutter_gen/gen_l10n/app_localizations.dart';");
      // const Center must have been stripped to Center!
      expect(res.transformedContent).not.toContain("const Center");
      expect(res.transformedContent).toContain("return Center(");
      expect(res.transformedContent).toContain("AppLocalizations.of(context)!.helloFlutter");
    });
  });
});

