import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { auditFormatting } from "../../src/core/formatting/formatting-auditor.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";

describe("Number, Date & Currency Formatting Auditor", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "formatting-audit-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should detect currency issues in JS/TS template literals", async () => {
    const pkgJson = {
      name: "test-react-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
export function PricingCard({ price }: { price: number }) {
  return (
    <div>
      <span>{\`$\${price}\`}</span>
    </div>
  );
}
`;
    await fs.writeFile(path.join(srcDir, "PricingCard.tsx"), code, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.totalIssues).toBe(1);
    expect(result.currencyIssuesCount).toBe(1);
    expect(result.issues[0]?.category).toBe("CURRENCY");
    expect(result.issues[0]?.rawExpression).toBe("`$${price}`");
    expect(result.issues[0]?.suggestedReplacement).toContain('currency: "USD"');
    expect(result.issues[0]?.autoFixable).toBe(true);
  });

  it("should detect currency concatenation with plus sign", async () => {
    const pkgJson = {
      name: "test-react-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
export const formatTotal = (total: number) => {
  return "$" + total;
};
`;
    await fs.writeFile(path.join(srcDir, "utils.ts"), code, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.currencyIssuesCount).toBe(1);
    expect(result.issues[0]?.rawExpression).toBe('"$" + total');
    expect(result.issues[0]?.suggestedReplacement).toContain('currency: "USD"');
  });

  it("should detect unlocalized .toFixed() decimal formatting", async () => {
    const pkgJson = {
      name: "test-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
export function formatMetric(score: number) {
  return score.toFixed(2);
}
`;
    await fs.writeFile(path.join(srcDir, "metric.ts"), code, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.numberIssuesCount).toBe(1);
    const issue = result.issues.find((i) => i.category === "NUMBER");
    expect(issue).toBeDefined();
    expect(issue?.rawExpression).toBe("score.toFixed(2)");
    expect(issue?.suggestedReplacement).toContain("minimumFractionDigits: 2");
  });

  it("should detect hardcoded percentage signs", async () => {
    const pkgJson = {
      name: "test-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
export const printDiscount = (rate: number) => \`\${rate}%\`;
`;
    await fs.writeFile(path.join(srcDir, "discount.ts"), code, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.percentageIssuesCount).toBe(1);
    const issue = result.issues.find((i) => i.category === "PERCENTAGE");
    expect(issue).toBeDefined();
    expect(issue?.suggestedReplacement).toContain('style: "percent"');
  });

  it("should detect unparameterized .toLocaleDateString() and .toLocaleTimeString()", async () => {
    const pkgJson = {
      name: "test-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
export function showDateTime(date: Date) {
  const d = date.toLocaleDateString();
  const t = date.toLocaleTimeString();
  return d + " " + t;
}
`;
    await fs.writeFile(path.join(srcDir, "date.ts"), code, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.dateIssuesCount).toBe(1);
    expect(result.timeIssuesCount).toBe(1);

    const dateIssue = result.issues.find((i) => i.category === "DATE");
    const timeIssue = result.issues.find((i) => i.category === "TIME");

    expect(dateIssue?.suggestedReplacement).toContain('dateStyle: "medium"');
    expect(timeIssue?.suggestedReplacement).toContain('timeStyle: "medium"');
  });

  it("should detect Flutter Dart currency interpolation", async () => {
    const pubspec = `
name: test_flutter_app
description: A new Flutter project.
dependencies:
  flutter:
    sdk: flutter
`;
    await fs.writeFile(path.join(tmpDir, "pubspec.yaml"), pubspec, "utf8");

    const libDir = path.join(tmpDir, "lib");
    await fs.mkdir(libDir, { recursive: true });

    const dartCode = `
import 'package:flutter/material.dart';

Widget buildPrice(double price) {
  return Text('\\$\${price}');
}
`;
    await fs.writeFile(path.join(libDir, "price.dart"), dartCode, "utf8");

    const result = await auditFormatting({ projectPath: tmpDir });

    expect(result.framework).toBe("flutter");
    expect(result.currencyIssuesCount).toBe(1);
    expect(result.issues[0]?.suggestedReplacement).toContain("NumberFormat.simpleCurrency");
  });

  it("should apply auto-fixes and generate unified diffs", async () => {
    const pkgJson = {
      name: "test-react-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const filePath = path.join(srcDir, "Price.tsx");
    const originalCode = `const getPrice = (val: number) => \`$\${val}\`;\n`;
    await fs.writeFile(filePath, originalCode, "utf8");

    // Dry-run
    const dryResult = await auditFormatting({
      projectPath: tmpDir,
      fix: true,
      dryRun: true,
    });

    expect(dryResult.diff).toBeDefined();
    expect(dryResult.diff).toContain("+ const getPrice = (val: number) => new Intl.NumberFormat");
    // Verify file was NOT modified on disk
    const contentAfterDry = await fs.readFile(filePath, "utf8");
    expect(contentAfterDry).toBe(originalCode);

    // Write to disk
    const writeResult = await auditFormatting({
      projectPath: tmpDir,
      fix: true,
      dryRun: false,
    });

    expect(writeResult.fixesApplied).toBe(1);
    const contentAfterWrite = await fs.readFile(filePath, "utf8");
    expect(contentAfterWrite).toContain("new Intl.NumberFormat(undefined, { style: \"currency\", currency: \"USD\" }).format(val)");
  });

  it("should filter by categories when specified", async () => {
    const pkgJson = {
      name: "test-app",
      dependencies: { react: "^18.0.0" },
    };
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify(pkgJson, null, 2),
      "utf8"
    );

    const srcDir = path.join(tmpDir, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const code = `
const price = \`$\${amount}\`;
const percent = \`\${rate}%\`;
`;
    await fs.writeFile(path.join(srcDir, "mixed.ts"), code, "utf8");

    const result = await auditFormatting({
      projectPath: tmpDir,
      categories: ["PERCENTAGE"],
    });

    expect(result.currencyIssuesCount).toBe(0);
    expect(result.percentageIssuesCount).toBe(1);
    expect(result.totalIssues).toBe(1);
  });
});
