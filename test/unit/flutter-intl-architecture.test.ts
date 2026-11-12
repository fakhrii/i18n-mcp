import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { scanDartSourceFile } from "../../src/core/scanner/dart-scanner.js";
import { stripInvalidDartConst, applySourceChangesToFile } from "../../src/core/replacement/ast-transformer.js";
import { detectProjectMetadata } from "../../src/core/discovery/project-detector.js";
import { detectI18n } from "../../src/core/discovery/i18n-detector.js";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import { getLocaleFilePath, planTargetLocales } from "../../src/core/planning/locale-change-planner.js";
import { DEFAULT_EXCLUDES, resolveProjectFiles } from "../../src/core/scope/scope-resolver.js";
import { buildReplacementExpression, analyzeFileTranslationContext } from "../../src/core/planning/source-change-planner.js";

describe("Flutter & flutter_intl Full Architecture Support", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "flutter-intl-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("1. Scope Resolution & Exclusions", () => {
    it("excludes .dart_tool, *.g.dart, *.freezed.dart, and generated l10n directories", () => {
      expect(DEFAULT_EXCLUDES).toContain("**/.dart_tool/**");
      expect(DEFAULT_EXCLUDES).toContain("**/*.g.dart");
      expect(DEFAULT_EXCLUDES).toContain("**/*.freezed.dart");
      expect(DEFAULT_EXCLUDES).toContain("**/*.mocks.dart");
      expect(DEFAULT_EXCLUDES).toContain("**/lib/generated/**");
      expect(DEFAULT_EXCLUDES).toContain("**/l10n/generated/**");
    });

    it("resolves project files while ignoring generated Flutter artifacts", async () => {
      const libDir = path.join(tempDir, "lib");
      const generatedDir = path.join(libDir, "generated");
      const dartToolDir = path.join(tempDir, ".dart_tool");

      await fs.mkdir(generatedDir, { recursive: true });
      await fs.mkdir(dartToolDir, { recursive: true });

      await fs.writeFile(path.join(libDir, "main.dart"), "void main() {}");
      await fs.writeFile(path.join(libDir, "user.g.dart"), "// generated");
      await fs.writeFile(path.join(generatedDir, "l10n.dart"), "// generated l10n");
      await fs.writeFile(path.join(dartToolDir, "package_config.json"), "{}");

      const files = await resolveProjectFiles(tempDir);
      expect(files).toContain("lib/main.dart");
      expect(files).not.toContain("lib/user.g.dart");
      expect(files).not.toContain("lib/generated/l10n.dart");
      expect(files.some((f) => f.includes(".dart_tool"))).toBe(false);
    });
  });

  describe("2. Complex Dart String Interpolations", () => {
    it("parses complex expressions with ternary operators and quotes without truncating", () => {
      const code = `
        final text1 = Text('Balance: \${balance < 0 ? "negative" : 'positive'}');
        final text2 = Text('Selected: \${items.map((e) => e.name).join(", ")} items');
      `;

      const results = scanDartSourceFile({
        filePath: "lib/account_card.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(2);

      // First string: balance ternary
      expect(results[0]!.text).toBe("Balance: {{balance}}");
      expect(results[0]!.variables).toEqual(["balance"]);
      expect(results[0]!.variableExpressions?.balance).toBe(
        'balance < 0 ? "negative" : \'positive\''
      );

      // Second string: method chain
      expect(results[1]!.text).toBe("Selected: {{join}} items");
      expect(results[1]!.variables).toEqual(["join"]);
    });
  });

  describe("3. BuildContext Contextual Detection (UI vs Non-UI Controllers)", () => {
    it("flags hasBuildContext=true for Widgets and hasBuildContext=false for Controllers", () => {
      const widgetCode = `
        class VoiceOverlay extends StatelessWidget {
          @override
          Widget build(BuildContext context) {
            return Text('Listening...');
          }
        }
      `;

      const controllerCode = `
        class ChatController extends GetxController {
          void sendMessage() {
            final error = 'Unable to connect to server';
          }
        }
      `;

      const widgetResults = scanDartSourceFile({
        filePath: "lib/features/voice_agent/presentation/voice_overlay.dart",
        sourceCode: widgetCode,
      });

      const controllerResults = scanDartSourceFile({
        filePath: "lib/features/voice_agent/controllers/chat_controller.dart",
        sourceCode: controllerCode,
      });

      expect(widgetResults).toHaveLength(1);
      expect(widgetResults[0]!.hasBuildContext).toBe(true);

      expect(controllerResults).toHaveLength(1);
      expect(controllerResults[0]!.hasBuildContext).toBe(false);
    });

    it("builds Localized.of(context) for UI and Localized.current for non-UI when using flutter_intl", () => {
      const flutterConfig = {
        engine: "flutter_intl" as const,
        className: "Localized",
        accessor: "Localized.of(context)",
        noContextAccessor: "Localized.current",
        arbPrefix: "intl_",
        arbDir: "lib/l10n",
        importStatement: "import 'package:dukhan/generated/l10n.dart';",
      };

      const fileContextUI = analyzeFileTranslationContext("", "useTranslation", "flutter_intl", flutterConfig);
      fileContextUI.filePath = "lib/presentation/view.dart";
      fileContextUI.flutterConfig = flutterConfig;

      const fileContextNonUI = analyzeFileTranslationContext("", "useTranslation", "flutter_intl", flutterConfig);
      fileContextNonUI.filePath = "lib/controllers/controller.dart";
      fileContextNonUI.flutterConfig = flutterConfig;

      const uiItem = {
        file: "lib/presentation/view.dart",
        line: 10,
        column: 5,
        text: "Submit",
        rawText: "'Submit'",
        type: "JSX_TEXT" as const,
        classification: "BUTTON" as const,
        confidence: 0.95,
        confidenceLevel: "HIGH" as const,
        suggestedNamespace: "intl_en",
        suggestedKey: "submit",
        reason: "Button",
        hasBuildContext: true,
      };

      const nonUiItem = {
        file: "lib/controllers/controller.dart",
        line: 15,
        column: 5,
        text: "Network error occurred",
        rawText: "'Network error occurred'",
        type: "STRING_LITERAL" as const,
        classification: "ERROR_MESSAGE" as const,
        confidence: 0.9,
        confidenceLevel: "HIGH" as const,
        suggestedNamespace: "intl_en",
        suggestedKey: "networkErrorOccurred",
        reason: "Error",
        hasBuildContext: false,
      };

      const uiReplacement = buildReplacementExpression(uiItem, "intl_en", "submit", fileContextUI);
      expect(uiReplacement).toBe("Localized.of(context).submit");

      const nonUiReplacement = buildReplacementExpression(nonUiItem, "intl_en", "networkErrorOccurred", fileContextNonUI);
      expect(nonUiReplacement).toBe("Localized.current.networkErrorOccurred");
    });
  });

  describe("4. Const Maps, Collections, and Declarations Transformation", () => {
    it("transforms static const Map into static final Map when Localized.current is used", () => {
      const original = [
        "class VoiceModeConstants {",
        "  static const Map<String, String> statusLabels = {",
        "    'idle': Localized.current.statusIdle,",
        "    'busy': Localized.current.statusBusy,",
        "  };",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(original);
      expect(result).toContain("static final Map<String, String> statusLabels = {");
      expect(result).not.toContain("static const");
    });

    it("transforms local const map variable to final map variable", () => {
      const original = [
        "Widget build(BuildContext context) {",
        "  const labels = {",
        "    'title': Localized.of(context).title,",
        "  };",
        "  return Text(labels['title']!);",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(original);
      expect(result).toContain("final labels = {");
      expect(result).not.toContain("const labels =");
    });

    it("strips const before Widget constructors and collection literals", () => {
      const original = [
        "Widget build(BuildContext context) {",
        "  return const Padding(",
        "    padding: EdgeInsets.all(8.0),",
        "    child: Text(Localized.of(context).welcome),",
        "  );",
        "}",
      ].join("\n");

      const result = stripInvalidDartConst(original);
      expect(result).toContain("return Padding(");
      expect(result).not.toContain("const Padding(");
    });
  });

  describe("5. flutter_intl Project Discovery & ARB Catalog Sync", () => {
    it("discovers flutter_intl configuration with custom Localized class and intl_ prefix", async () => {
      const pubspec = `
name: dukhan_app
description: Dukhan banking app

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

dev_dependencies:
  intl_utils: ^2.8.8

flutter_intl:
  enabled: true
  class_name: Localized
  main_locale: en
  arb_dir: lib/l10n
  output_dir: lib/generated
`;

      const l10nDir = path.join(tempDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });
      await fs.writeFile(path.join(tempDir, "pubspec.yaml"), pubspec);
      await fs.writeFile(path.join(l10nDir, "intl_en.arb"), JSON.stringify({ "@@locale": "en", "welcome": "Welcome" }));
      await fs.writeFile(path.join(l10nDir, "intl_ar.arb"), JSON.stringify({ "@@locale": "ar", "welcome": "مرحبا" }));

      const meta = await detectProjectMetadata(tempDir);
      expect(meta.framework).toBe("flutter");
      expect(meta.packageName).toBe("dukhan_app");

      const i18nInfo = await detectI18n(tempDir, meta.dependencies);
      expect(i18nInfo.i18n.library).toBe("flutter_intl");
      expect(i18nInfo.flutterConfig).toBeDefined();
      expect(i18nInfo.flutterConfig?.engine).toBe("flutter_intl");
      expect(i18nInfo.flutterConfig?.className).toBe("Localized");
      expect(i18nInfo.flutterConfig?.arbPrefix).toBe("intl_");
      expect(i18nInfo.flutterConfig?.arbDir).toBe("lib/l10n");
      expect(i18nInfo.flutterConfig?.accessor).toBe("Localized.of(context)");
      expect(i18nInfo.flutterConfig?.noContextAccessor).toBe("Localized.current");
      expect(i18nInfo.flutterConfig?.importStatement).toBe("import 'package:dukhan_app/generated/l10n.dart';");
    });

    it("derives intl_ar.arb for target locale 'ar' instead of app_ar.arb or intl_en.arb", () => {
      const pathEn = getLocaleFilePath("lib/l10n", "en", "intl_en", false, true, "intl_");
      const pathAr = getLocaleFilePath("lib/l10n", "ar", "intl_en", false, true, "intl_");

      expect(pathEn).toBe("lib/l10n/intl_en.arb");
      expect(pathAr).toBe("lib/l10n/intl_ar.arb");
    });

    it("generates a complete migration plan targeting intl_en.arb and intl_ar.arb", async () => {
      const pubspec = `
name: dukhan_app
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
dev_dependencies:
  intl_utils: ^2.8.8
flutter_intl:
  enabled: true
  class_name: Localized
  main_locale: en
  arb_dir: lib/l10n
`;
      const l10nDir = path.join(tempDir, "lib", "l10n");
      const presDir = path.join(tempDir, "lib", "presentation");
      await fs.mkdir(l10nDir, { recursive: true });
      await fs.mkdir(presDir, { recursive: true });

      await fs.writeFile(path.join(tempDir, "pubspec.yaml"), pubspec);
      await fs.writeFile(path.join(l10nDir, "intl_en.arb"), JSON.stringify({ "@@locale": "en", "hello": "Hello" }, null, 2));
      await fs.writeFile(path.join(l10nDir, "intl_ar.arb"), JSON.stringify({ "@@locale": "ar", "hello": "مرحبا" }, null, 2));

      const screenDart = `
import 'package:flutter/material.dart';

class HomeScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Account Balance')),
      body: Center(child: Text('Transfer Funds')),
    );
  }
}
`;
      await fs.writeFile(path.join(presDir, "home_screen.dart"), screenDart);

      const plan = await generateI18nPlan({
        projectPath: tempDir,
        targetLocales: ["ar"],
      });

      expect(plan.summary.userFacingCount).toBe(2);

      // Verify source changes use Localized.of(context)
      const replacements = plan.sourceChanges.map((sc) => sc.replacement);
      expect(replacements).toContain("Localized.of(context).accountBalance");
      expect(replacements).toContain("Localized.of(context).transferFunds");

      // Verify target translation files point to intl_ar.arb (NOT app_ar.arb)
      for (const t of plan.translations) {
        expect(t.sourceLocale.filePath).toBe("lib/l10n/intl_en.arb");
        const arTarget = t.targets.find((tgt) => tgt.locale === "ar");
        expect(arTarget).toBeDefined();
        expect(arTarget?.filePath).toBe("lib/l10n/intl_ar.arb");
      }

      // Verify required code changes import dukhan_app generated l10n.dart
      const homeSC = plan.sourceChanges.find((sc) => sc.file.includes("home_screen.dart"));
      expect(homeSC?.requiredCodeChanges).toBeDefined();
      const importChange = homeSC?.requiredCodeChanges?.find((c) => c.type === "ADD_IMPORT");
      expect(importChange?.module).toBe("package:dukhan_app/generated/l10n.dart");
      expect(importChange?.value).toBe("Localized");
    });
  });
});
