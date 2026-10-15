import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { analyzeProject } from "../../src/core/discovery/project-analyzer.js";
import { scanHardcodedTexts } from "../../src/core/scanner/scanner.js";
import { generateI18nPlan } from "../../src/core/planning/plan-generator.js";
import { applyI18nPlan } from "../../src/core/replacement/plan-applicator.js";
import { fileExists, readJsonFile, readTextFile } from "../../src/utils/file-system.js";

describe("Cross-Framework End-to-End Internationalization Tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-frameworks-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. FLUTTER FRAMEWORK LIFECYCLE
  // =========================================================================
  describe("Flutter Framework Lifecycle", () => {
    beforeEach(async () => {
      // 1. pubspec.yaml
      await fs.writeFile(
        path.join(tempDir, "pubspec.yaml"),
        `name: sample_flutter_app
description: A new Flutter application.
version: 1.0.0+1
environment:
  sdk: '>=3.0.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  intl: any
`,
        "utf8"
      );

      // 2. lib/l10n/app_en.arb
      const l10nDir = path.join(tempDir, "lib", "l10n");
      await fs.mkdir(l10nDir, { recursive: true });
      await fs.writeFile(
        path.join(l10nDir, "app_en.arb"),
        JSON.stringify(
          {
            "@@locale": "en",
            appTitle: "Existing App Title",
            "@appTitle": {
              description: "Existing header title in application",
            },
          },
          null,
          2
        ),
        "utf8"
      );

      // 3. lib/main.dart with hardcoded strings
      const libDir = path.join(tempDir, "lib");
      await fs.writeFile(
        path.join(libDir, "main.dart"),
        `import 'package:flutter/material.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(
          title: Text('Dashboard Overview'),
        ),
        body: Center(
          child: Column(
            children: [
              Text('Welcome back to your account'),
              TextField(
                decoration: InputDecoration(
                  labelText: 'Email Address',
                  hintText: 'Enter your email',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
`,
        "utf8"
      );
    });

    it("analyzes Flutter project, detects flutter_localizations and flat ARB structure", async () => {
      const analysis = await analyzeProject(tempDir);

      expect(analysis.framework).toBe("flutter");
      expect(analysis.language).toBe("dart");
      expect(analysis.packageManager).toBe("pub");
      expect(analysis.i18n.detected).toBe(true);
      expect(analysis.i18n.library).toBe("flutter_localizations");
      expect(analysis.i18n.localeDirectory).toBe("lib/l10n");
      expect(analysis.i18n.structureType).toBe("flat");
      expect(analysis.i18n.sourceLocale).toBe("en");
    });

    it("scans hardcoded texts across Dart files in lib/ folder", async () => {
      const scan = await scanHardcodedTexts(tempDir);

      expect(scan.total).toBeGreaterThanOrEqual(4);
      expect(scan.userFacingCount).toBeGreaterThanOrEqual(4);

      const texts = scan.items.map((i) => i.text);
      expect(texts).toContain("Dashboard Overview");
      expect(texts).toContain("Welcome back to your account");
      expect(texts).toContain("Email Address");
      expect(texts).toContain("Enter your email");

      for (const item of scan.items) {
        expect(item.file).toBe("lib/main.dart");
        expect(item.confidence).toBeGreaterThanOrEqual(0.85);
      }
    });

    it("generates and applies i18n plan for Flutter, updating ARB and Dart source code", async () => {
      const plan = await generateI18nPlan({ projectPath: tempDir });

      expect(plan.translations.length).toBeGreaterThanOrEqual(4);
      expect(plan.sourceChanges.length).toBeGreaterThanOrEqual(4);

      // Verify all planned translations target the app_en.arb file
      for (const t of plan.translations) {
        expect(t.sourceLocale.filePath).toBe("lib/l10n/app_en.arb");
        expect(t.action).toBe("CREATE");
      }

      // Verify Dart source replacement syntax
      for (const sc of plan.sourceChanges) {
        expect(sc.replacement).toMatch(/AppLocalizations\.of\(context\)!\.[a-zA-Z0-9]+/);
      }

      // Apply the plan
      const applyResult = await applyI18nPlan({
        projectPath: tempDir,
        plan,
        dryRun: false,
      });

      expect(applyResult.success).toBe(true);
      expect(applyResult.sourceChangesApplied).toBeGreaterThanOrEqual(4);
      expect(applyResult.translationEntriesCreated).toBeGreaterThanOrEqual(4);

      // Verify ARB file updated
      const arbContent = await readTextFile(path.join(tempDir, "lib", "l10n", "app_en.arb"));
      const parsedArb = JSON.parse(arbContent);
      expect(parsedArb["@@locale"]).toBe("en");
      expect(parsedArb["appTitle"]).toBe("Existing App Title"); // preserved
      expect(parsedArb["dashboardOverview"]).toBe("Dashboard Overview");
      expect(parsedArb["@dashboardOverview"]).toBeDefined();
      expect(parsedArb["welcomeBackToYourAccount"]).toBe("Welcome back to your account");
      expect(parsedArb["@welcomeBackToYourAccount"]).toBeDefined();

      // Verify main.dart updated
      const updatedDart = await readTextFile(path.join(tempDir, "lib", "main.dart"));
      expect(updatedDart).toContain("import 'package:flutter_gen/gen_l10n/app_localizations.dart';");
      expect(updatedDart).toContain("AppLocalizations.of(context)!.dashboardOverview");
      expect(updatedDart).toContain("AppLocalizations.of(context)!.welcomeBackToYourAccount");
      expect(updatedDart).toContain("AppLocalizations.of(context)!.emailAddress");
      expect(updatedDart).toContain("AppLocalizations.of(context)!.enterYourEmail");

      // Verify Idempotency: re-scanning should find 0 remaining hardcoded user-facing strings
      const reScan = await scanHardcodedTexts(tempDir);
      expect(reScan.userFacingCount).toBe(0);
    });
  });

  // =========================================================================
  // 2. REACT NATIVE FRAMEWORK LIFECYCLE
  // =========================================================================
  describe("React Native Framework Lifecycle", () => {
    beforeEach(async () => {
      // 1. package.json with react-native
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "sample-rn-app",
            version: "1.0.0",
            dependencies: {
              react: "18.3.1",
              "react-native": "0.76.0",
            },
          },
          null,
          2
        )
      );

      // 2. tsconfig.json
      await fs.writeFile(
        path.join(tempDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { jsx: "react" } })
      );

      // 3. src/screens/HomeScreen.tsx with mobile components & props
      const screensDir = path.join(tempDir, "src", "screens");
      await fs.mkdir(screensDir, { recursive: true });
      await fs.writeFile(
        path.join(screensDir, "HomeScreen.tsx"),
        `import React from 'react';
import { View, Text, Button, Alert } from 'react-native';

export function HomeScreen() {
  const handleAlert = () => {
    Alert.alert("Permission Required", "Please grant notification permission");
  };

  return (
    <View>
      <Text>Welcome to Mobile Experience</Text>
      <Button title="Continue Setup" onPress={handleAlert} />
    </View>
  );
}
`,
        "utf8"
      );
    });

    it("analyzes React Native project and detects framework correctly", async () => {
      const analysis = await analyzeProject(tempDir);

      expect(analysis.framework).toBe("react-native");
      expect(analysis.language).toBe("typescript");
      expect(analysis.i18n.detected).toBe(false);
      expect(analysis.i18n.needsSetup).toBe(true);
    });

    it("scans React Native text components, button titles, and feedback alerts", async () => {
      const scan = await scanHardcodedTexts(tempDir);

      expect(scan.total).toBeGreaterThanOrEqual(4);
      expect(scan.userFacingCount).toBeGreaterThanOrEqual(4);

      const texts = scan.items.map((i) => i.text);
      expect(texts).toContain("Welcome to Mobile Experience");
      expect(texts).toContain("Continue Setup");
      expect(texts).toContain("Permission Required");
      expect(texts).toContain("Please grant notification permission");
    });

    it("plans and applies i18n setup, injecting useTranslation hook and updating package.json", async () => {
      const plan = await generateI18nPlan({ projectPath: tempDir });

      expect(plan.setup).toBeDefined();
      expect(plan.setup?.needed).toBe(true);
      expect(plan.setup?.configFile).toBe("src/i18n/index.ts");
      expect(plan.setup?.dependenciesToAdd).toHaveProperty("react-i18next");
      expect(plan.setup?.dependenciesToAdd).toHaveProperty("i18next");

      const applyResult = await applyI18nPlan({
        projectPath: tempDir,
        plan,
        dryRun: false,
      });

      expect(applyResult.success).toBe(true);
      expect(applyResult.sourceChangesApplied).toBeGreaterThanOrEqual(4);

      // Verify i18n config file created with compatibilityJSON: 'v3' for React Native
      const configContent = await readTextFile(path.join(tempDir, "src", "i18n", "index.ts"));
      expect(configContent).toContain("compatibilityJSON: \"v3\"");
      expect(configContent).toContain("initReactI18next");

      // Verify HomeScreen.tsx was updated with useTranslation and t(...)
      const screenContent = await readTextFile(
        path.join(tempDir, "src", "screens", "HomeScreen.tsx")
      );
      expect(screenContent).toContain("import { useTranslation } from \"react-i18next\";");
      expect(screenContent).toContain("const { t } = useTranslation(");
      expect(screenContent).toContain("{t(");
      expect(screenContent).toContain("title={t(");

      // Verify package.json updated with dependencies
      const pkg = await readJsonFile<any>(path.join(tempDir, "package.json"));
      expect(pkg.dependencies).toHaveProperty("react-i18next");
      expect(pkg.dependencies).toHaveProperty("i18next");

      // Verify locale json created
      const localePath = path.join(tempDir, "src", "locales", "en", "common.json");
      expect(await fileExists(localePath)).toBe(true);
      const localeJson = await readJsonFile<any>(localePath);
      expect(Object.keys(localeJson).length).toBeGreaterThanOrEqual(4);
    });
  });

  // =========================================================================
  // 3. REACT (WEB) FRAMEWORK LIFECYCLE
  // =========================================================================
  describe("React (Web) Framework Lifecycle", () => {
    beforeEach(async () => {
      // 1. package.json with react and react-dom (no react-native)
      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "sample-react-web-app",
            version: "1.0.0",
            dependencies: {
              react: "18.3.1",
              "react-dom": "18.3.1",
            },
          },
          null,
          2
        )
      );

      // 2. tsconfig.json
      await fs.writeFile(
        path.join(tempDir, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { jsx: "react" } })
      );

      // 3. src/App.tsx with HTML semantic tags, button, placeholder, alt, aria-label
      const srcDir = path.join(tempDir, "src");
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(
        path.join(srcDir, "App.tsx"),
        `import React from 'react';

export default function App() {
  return (
    <main>
      <h1>Summer Fashion Collection</h1>
      <p>Discover our exclusive handcrafted accessories</p>
      <input type="text" placeholder="Search product catalog" />
      <button aria-label="Add Summer Collection to cart">Add to Cart</button>
      <img src="/hero.png" alt="Seasonal fashion banner" />
    </main>
  );
}
`,
        "utf8"
      );
    });

    it("analyzes React Web project and detects framework as 'react'", async () => {
      const analysis = await analyzeProject(tempDir);

      expect(analysis.framework).toBe("react");
      expect(analysis.language).toBe("typescript");
      expect(analysis.i18n.detected).toBe(false);
      expect(analysis.i18n.needsSetup).toBe(true);
    });

    it("scans semantic HTML elements, placeholders, alt attributes, and ARIA labels", async () => {
      const scan = await scanHardcodedTexts(tempDir);

      expect(scan.total).toBeGreaterThanOrEqual(5);
      expect(scan.userFacingCount).toBeGreaterThanOrEqual(5);

      const texts = scan.items.map((i) => i.text);
      expect(texts).toContain("Summer Fashion Collection");
      expect(texts).toContain("Discover our exclusive handcrafted accessories");
      expect(texts).toContain("Search product catalog");
      expect(texts).toContain("Add to Cart");
      expect(texts).toContain("Add Summer Collection to cart");
      expect(texts).toContain("Seasonal fashion banner");
    });

    it("plans and applies i18n setup for React Web, converting HTML elements and attributes", async () => {
      const plan = await generateI18nPlan({ projectPath: tempDir });

      expect(plan.setup).toBeDefined();
      expect(plan.setup?.needed).toBe(true);
      expect(plan.setup?.configFile).toBe("src/i18n/index.ts");
      expect(plan.setup?.entryFile).toBe("src/App.tsx");

      const applyResult = await applyI18nPlan({
        projectPath: tempDir,
        plan,
        dryRun: false,
      });

      expect(applyResult.success).toBe(true);
      expect(applyResult.sourceChangesApplied).toBeGreaterThanOrEqual(5);

      // Verify App.tsx updated with imports, hook, and JSX interpolations
      const updatedApp = await readTextFile(path.join(tempDir, "src", "App.tsx"));
      expect(updatedApp).toContain("import { useTranslation } from \"react-i18next\";");
      expect(updatedApp).toContain("const { t } = useTranslation(");
      expect(updatedApp).toContain("<h1>{t(");
      expect(updatedApp).toContain("<p>{t(");
      expect(updatedApp).toContain("placeholder={t(");
      expect(updatedApp).toContain("aria-label={t(");
      expect(updatedApp).toContain("alt={t(");

      // Verify package.json updated
      const pkg = await readJsonFile<any>(path.join(tempDir, "package.json"));
      expect(pkg.dependencies).toHaveProperty("react-i18next");
      expect(pkg.dependencies).toHaveProperty("i18next");

      // Verify locale resource file created
      const localePath = path.join(tempDir, "src", "locales", "en", "common.json");
      expect(await fileExists(localePath)).toBe(true);
      const localeJson = await readJsonFile<any>(localePath);
      expect(Object.keys(localeJson).length).toBeGreaterThanOrEqual(5);
    });
  });
});
