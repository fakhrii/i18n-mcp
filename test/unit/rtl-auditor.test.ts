import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { isRtlLocale, auditRtlLayout } from "../../src/core/rtl/rtl-auditor.js";
import { writeTextFile } from "../../src/utils/file-system.js";

describe("RTL & Bidirectional Layout Auditor Unit Tests", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `i18n-rtl-test-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("identifies RTL locales accurately", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("ar-SA")).toBe(true);
    expect(isRtlLocale("he")).toBe(true);
    expect(isRtlLocale("fa-IR")).toBe(true);
    expect(isRtlLocale("ur")).toBe(true);
    expect(isRtlLocale("en")).toBe(false);
    expect(isRtlLocale("fr")).toBe(false);
    expect(isRtlLocale("es")).toBe(false);
  });

  it("detects React Native physical styles and auto-fixes to logical equivalents", async () => {
    const pkgJson = JSON.stringify({
      name: "test-rn-app",
      dependencies: { "react-native": "0.74.0" },
    });
    await writeTextFile(path.join(tmpDir, "package.json"), pkgJson);

    const sourceRn = `
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const Card = () => (
  <View style={styles.container}>
    <Text style={styles.title}>Welcome</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    marginLeft: 16,
    paddingRight: 20,
    borderTopLeftRadius: 8,
    textAlign: 'left',
  },
  title: {
    left: 10,
  },
});
`;
    const filePath = path.join(tmpDir, "src/components/Card.tsx");
    await writeTextFile(filePath, sourceRn);

    const audit = await auditRtlLayout({
      projectPath: tmpDir,
      targetLocales: ["ar"],
      fix: true,
      dryRun: false,
    });

    expect(audit.isRtlTargeted).toBe(true);
    expect(audit.totalIssues).toBeGreaterThanOrEqual(4);

    const categories = audit.issues.map((i) => i.category);
    expect(categories).toContain("PHYSICAL_SPACING");
    expect(categories).toContain("PHYSICAL_ALIGNMENT");

    // Verify auto-fixes applied to file
    const modified = await fs.readFile(filePath, "utf-8");
    expect(modified).toContain("marginStart: 16");
    expect(modified).toContain("paddingEnd: 20");
    expect(modified).toContain("borderTopStartRadius: 8");
    expect(modified).toContain("textAlign: 'auto'");
    expect(modified).toContain("start: 10");
  });

  it("detects Flutter physical EdgeInsets and Alignment", async () => {
    const pubspec = `
name: test_flutter_app
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
`;
    await writeTextFile(path.join(tmpDir, "pubspec.yaml"), pubspec);

    const sourceDart = `
import 'package:flutter/material.dart';

class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(left: 16.0, right: 8.0),
      alignment: Alignment.centerLeft,
      child: Text('Hello'),
    );
  }
}
`;
    const dartPath = path.join(tmpDir, "lib/my_widget.dart");
    await writeTextFile(dartPath, sourceDart);

    const audit = await auditRtlLayout({
      projectPath: tmpDir,
      targetLocales: ["he"],
      fix: true,
      dryRun: false,
    });

    expect(audit.isRtlTargeted).toBe(true);
    const modifiedDart = await fs.readFile(dartPath, "utf-8");
    expect(modifiedDart).toContain("EdgeInsetsDirectional.only");
    expect(modifiedDart).toContain("AlignmentDirectional.centerStart");
  });

  it("detects Tailwind physical classes and directional icons", async () => {
    const pkgJson = JSON.stringify({
      name: "test-web-app",
      dependencies: { "react": "18.2.0" },
    });
    await writeTextFile(path.join(tmpDir, "package.json"), pkgJson);

    const sourceWeb = `
import React from 'react';
import { ChevronRight } from 'lucide-react';

export const NextButton = () => (
  <button className="ml-4 pr-2 text-left">
    <span>Next -></span>
    <ChevronRight name="chevron-right" />
  </button>
);
`;
    const webPath = path.join(tmpDir, "src/NextButton.tsx");
    await writeTextFile(webPath, sourceWeb);

    const audit = await auditRtlLayout({
      projectPath: tmpDir,
      targetLocales: ["ar"],
      fix: true,
      dryRun: false,
    });

    const categories = audit.issues.map((i) => i.category);
    expect(categories).toContain("PHYSICAL_SPACING");
    expect(categories).toContain("DIRECTIONAL_ICON");
    expect(categories).toContain("DIRECTIONAL_GLYPH");

    const modifiedWeb = await fs.readFile(webPath, "utf-8");
    expect(modifiedWeb).toContain("ms-4");
    expect(modifiedWeb).toContain("pe-2");
    expect(modifiedWeb).toContain("text-start");
  });
});
