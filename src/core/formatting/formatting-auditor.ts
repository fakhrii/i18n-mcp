import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  FormattingAuditOptions,
  FormattingAuditResult,
  FormattingIssue,
  FormattingIssueCategory,
} from "../../models/formatting.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { resolveProjectFiles } from "../scope/scope-resolver.js";
import { readTextFile, toPosixPath } from "../../utils/file-system.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₩": "KRW",
  "₪": "ILS",
  "USD": "USD",
  "EUR": "EUR",
  "GBP": "GBP",
  "CAD": "CAD",
  "AUD": "AUD",
  "CHF": "CHF",
};

function getLineAndColumn(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1]!.length + 1;
  return { line, column };
}

/**
 * Audits project source files for hardcoded currencies, manual number decimals, percentages, and unlocalized date formatting.
 */
export async function auditFormatting(
  options: FormattingAuditOptions = {}
): Promise<FormattingAuditResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const fix = options.fix ?? false;
  const dryRun = options.dryRun ?? true;
  const targetCategories = options.categories
    ? new Set(options.categories)
    : new Set<FormattingIssueCategory>(["CURRENCY", "NUMBER", "PERCENTAGE", "DATE", "TIME"]);

  logger.info(
    `Auditing Number, Date & Currency formatting in ${projectRoot} (fix=${fix}, dryRun=${dryRun})`
  );

  let analysis;
  try {
    analysis = await analyzeProject(projectRoot);
  } catch (err: unknown) {
    return {
      projectRoot,
      framework: "unknown",
      totalIssues: 0,
      currencyIssuesCount: 0,
      numberIssuesCount: 0,
      percentageIssuesCount: 0,
      dateIssuesCount: 0,
      fixableCount: 0,
      issues: [],
      filesAffected: [],
    };
  }

  const framework = analysis.framework || "react-native";
  const isFlutter = framework === "flutter";

  // Resolve scope files
  const files = await resolveProjectFiles(projectRoot, {
    scope: options.scope,
    include: options.include,
    exclude: options.exclude,
  });

  const issues: FormattingIssue[] = [];
  let currencyIssuesCount = 0;
  let numberIssuesCount = 0;
  let percentageIssuesCount = 0;
  let dateIssuesCount = 0;
  let timeIssuesCount = 0;
  let fixesApplied = 0;
  const filesModified: string[] = [];
  const diffParts: string[] = [];

  for (const file of files) {
    const absPath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
    const relPath = toPosixPath(path.relative(projectRoot, absPath));
    const ext = path.extname(absPath).toLowerCase();
    const isSourceFile = [".tsx", ".ts", ".jsx", ".js", ".vue", ".dart", ".html"].includes(ext);
    if (!isSourceFile) continue;

    const content = (await readTextFile(absPath)) || "";
    if (!content.trim()) continue;

    let updatedContent = content;
    let fileHasFixes = false;

    // 1. CURRENCY AUDIT
    if (targetCategories.has("CURRENCY")) {
      // Pattern A: Template literals: `$${price}` or `${price} €` or `$${item.price.toFixed(2)}`
      const tmplRegex = /`([^`]*?)(\$|€|£|¥|₹|₽|₩|₪|USD|EUR|GBP)\s*\$\{([^}]+)\}([^`]*?)`/g;
      let match: RegExpExecArray | null;

      while ((match = tmplRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const prefixText = match[1] || "";
        const symbol = match[2]!;
        const rawVar = match[3]!.trim();
        const suffixText = match[4] || "";

        // Strip .toFixed(...) from variable expression if present
        const cleanVar = rawVar.replace(/\.toFixed\([^)]*\)$/, "").trim();
        const currencyCode = CURRENCY_SYMBOL_MAP[symbol] || "USD";
        const { line, column } = getLineAndColumn(content, match.index);

        let replacement: string;
        if (isFlutter) {
          replacement = `NumberFormat.simpleCurrency(name: '${currencyCode}').format(${cleanVar})`;
        } else {
          replacement = `new Intl.NumberFormat(undefined, { style: "currency", currency: "${currencyCode}" }).format(${cleanVar})`;
        }

        const suggestedExpr = prefixText || suffixText
          ? `\`${prefixText}\${${replacement}}${suffixText}\``
          : replacement;

        currencyIssuesCount++;
        issues.push({
          id: `${relPath}:${line}:${column}:currency-tmpl`,
          file: relPath,
          line,
          column,
          category: "CURRENCY",
          severity: "warning",
          rawExpression: fullMatch,
          detectedSymbolOrMethod: symbol,
          framework,
          message: `Hardcoded currency symbol '${symbol}' in template literal. Use localized currency formatter.`,
          suggestedReplacement: suggestedExpr,
          autoFixable: true,
        });

        if (fix && !prefixText && !suffixText) {
          updatedContent = updatedContent.replace(fullMatch, replacement);
          fileHasFixes = true;
          fixesApplied++;
        }
      }

      // Pattern B: Dart string interpolation: '\$${item.price}' or "\$${price}"
      if (isFlutter) {
        const dartRegex = /(['"])(\\\$|€|£|¥)\$\{([^}]+)\}\1/g;
        while ((match = dartRegex.exec(content)) !== null) {
          const fullMatch = match[0];
          const rawSymbol = match[2]!;
          const symbol = rawSymbol.replace(/\\/g, "");
          const rawVar = match[3]!.trim();
          const cleanVar = rawVar.replace(/\.toStringAsFixed\([^)]*\)$/, "").trim();
          const currencyCode = CURRENCY_SYMBOL_MAP[symbol] || "USD";
          const { line, column } = getLineAndColumn(content, match.index);

          const replacement = `NumberFormat.simpleCurrency(name: '${currencyCode}').format(${cleanVar})`;
          currencyIssuesCount++;
          issues.push({
            id: `${relPath}:${line}:${column}:dart-currency`,
            file: relPath,
            line,
            column,
            category: "CURRENCY",
            severity: "warning",
            rawExpression: fullMatch,
            detectedSymbolOrMethod: symbol,
            framework,
            message: `Hardcoded currency symbol '${symbol}' in Dart string interpolation.`,
            suggestedReplacement: replacement,
            autoFixable: true,
          });

          if (fix) {
            updatedContent = updatedContent.replace(fullMatch, replacement);
            fileHasFixes = true;
            fixesApplied++;
          }
        }
      }

      // Pattern C: Binary concatenation: "$" + price or price + " €"
      const concatRegex = /(["'])(\$|€|£|¥|₹|₽|₩|₪)\s*\1\s*\+\s*([a-zA-Z0-9_.]+)(?!\s*\+)/g;
      while ((match = concatRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const symbol = match[2]!;
        const rawVar = match[3]!.trim();
        const cleanVar = rawVar.replace(/\.toFixed\([^)]*\)$/, "").trim();
        const currencyCode = CURRENCY_SYMBOL_MAP[symbol] || "USD";
        const { line, column } = getLineAndColumn(content, match.index);

        const replacement = isFlutter
          ? `NumberFormat.simpleCurrency(name: '${currencyCode}').format(${cleanVar})`
          : `new Intl.NumberFormat(undefined, { style: "currency", currency: "${currencyCode}" }).format(${cleanVar})`;

        currencyIssuesCount++;
        issues.push({
          id: `${relPath}:${line}:${column}:currency-concat`,
          file: relPath,
          line,
          column,
          category: "CURRENCY",
          severity: "warning",
          rawExpression: fullMatch,
          detectedSymbolOrMethod: symbol,
          framework,
          message: `Hardcoded currency concatenation with '${symbol}'.`,
          suggestedReplacement: replacement,
          autoFixable: true,
        });

        if (fix) {
          updatedContent = updatedContent.replace(fullMatch, replacement);
          fileHasFixes = true;
          fixesApplied++;
        }
      }
    }

    // 2. PERCENTAGE AUDIT
    if (targetCategories.has("PERCENTAGE")) {
      // Matches `${rate}%` or `${rate} %`
      const percentTmplRegex = /`([^`]*?)\$\{([^}]+)\}\s*%([^`]*?)`/g;
      let match: RegExpExecArray | null;

      while ((match = percentTmplRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const prefixText = match[1] || "";
        const rawVar = match[2]!.trim();
        const suffixText = match[3] || "";
        const { line, column } = getLineAndColumn(content, match.index);

        const replacement = isFlutter
          ? `NumberFormat.percentPattern().format(${rawVar} / 100)`
          : `new Intl.NumberFormat(undefined, { style: "percent" }).format(${rawVar} / 100)`;

        const suggestedExpr = prefixText || suffixText
          ? `\`${prefixText}\${${replacement}}${suffixText}\``
          : replacement;

        percentageIssuesCount++;
        issues.push({
          id: `${relPath}:${line}:${column}:percent-tmpl`,
          file: relPath,
          line,
          column,
          category: "PERCENTAGE",
          severity: "warning",
          rawExpression: fullMatch,
          detectedSymbolOrMethod: "%",
          framework,
          message: `Hardcoded percentage suffix '%' in template literal. Spacing and symbol placement vary by locale.`,
          suggestedReplacement: suggestedExpr,
          autoFixable: !prefixText && !suffixText,
        });

        if (fix && !prefixText && !suffixText) {
          updatedContent = updatedContent.replace(fullMatch, replacement);
          fileHasFixes = true;
          fixesApplied++;
        }
      }
    }

    // 3. NUMBER AUDIT (.toFixed() / .toStringAsFixed() unlocalized)
    if (targetCategories.has("NUMBER")) {
      const toFixedRegex = /([a-zA-Z0-9_.]+)\.toFixed\(([0-9]*)\)/g;
      let match: RegExpExecArray | null;

      while ((match = toFixedRegex.exec(content)) !== null) {
        // Skip if already inside an Intl.NumberFormat or currency replacement
        const matchIndex = match.index;
        const surroundingPrefix = content.slice(Math.max(0, matchIndex - 30), matchIndex);
        if (surroundingPrefix.includes("Intl.NumberFormat") || surroundingPrefix.includes("NumberFormat")) {
          continue;
        }

        const fullMatch = match[0];
        const varName = match[1]!;
        const decimals = match[2] ? parseInt(match[2], 10) : 0;
        const { line, column } = getLineAndColumn(content, match.index);

        const replacement = isFlutter
          ? `NumberFormat.decimalPattern().format(${varName})`
          : `new Intl.NumberFormat(undefined, { minimumFractionDigits: ${decimals}, maximumFractionDigits: ${decimals} }).format(${varName})`;

        numberIssuesCount++;
        issues.push({
          id: `${relPath}:${line}:${column}:to-fixed`,
          file: relPath,
          line,
          column,
          category: "NUMBER",
          severity: "warning",
          rawExpression: fullMatch,
          detectedSymbolOrMethod: ".toFixed()",
          framework,
          message: `Unlocalized decimal formatting via '.toFixed()'. Decimal separator (dot vs comma) depends on user locale.`,
          suggestedReplacement: replacement,
          autoFixable: false,
        });
      }
    }

    // 4. DATE & TIME AUDIT
    if (targetCategories.has("DATE") || targetCategories.has("TIME")) {
      // Matches .toLocaleDateString() or .toLocaleTimeString() called with 0 arguments
      const unparamDateRegex = /([a-zA-Z0-9_.]+)\.(toLocaleDateString|toLocaleTimeString)\(\s*\)/g;
      let match: RegExpExecArray | null;

      while ((match = unparamDateRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const varName = match[1]!;
        const method = match[2]!;
        const isTime = method === "toLocaleTimeString";
        if (isTime && !targetCategories.has("TIME")) continue;
        if (!isTime && !targetCategories.has("DATE")) continue;

        const { line, column } = getLineAndColumn(content, match.index);

        const styleProp = isTime ? 'timeStyle: "medium"' : 'dateStyle: "medium"';
        const replacement = `new Intl.DateTimeFormat(undefined, { ${styleProp} }).format(${varName})`;

        if (isTime) {
          timeIssuesCount++;
        } else {
          dateIssuesCount++;
        }
        issues.push({
          id: `${relPath}:${line}:${column}:unparam-date`,
          file: relPath,
          line,
          column,
          category: isTime ? "TIME" : "DATE",
          severity: "warning",
          rawExpression: fullMatch,
          detectedSymbolOrMethod: `.${method}()`,
          framework,
          message: `Calling '.${method}()' without explicit locale or formatting options produces inconsistent platform output.`,
          suggestedReplacement: replacement,
          autoFixable: true,
        });

        if (fix) {
          updatedContent = updatedContent.replace(fullMatch, replacement);
          fileHasFixes = true;
          fixesApplied++;
        }
      }
    }

    if (fileHasFixes && updatedContent !== content) {
      const diff = generateUnifiedDiff(relPath, content, updatedContent);
      if (diff) diffParts.push(diff);
      filesModified.push(relPath);

      if (!dryRun) {
        await fs.writeFile(absPath, updatedContent, "utf8");
      }
    }
  }

  const filesAffected = Array.from(new Set(issues.map((i) => i.file)));
  const fixableCount = issues.filter((i) => i.autoFixable).length;

  return {
    projectRoot,
    framework,
    totalIssues: issues.length,
    currencyIssuesCount,
    numberIssuesCount,
    percentageIssuesCount,
    dateIssuesCount,
    timeIssuesCount,
    fixableCount,
    issues,
    filesAffected,
    fixesApplied: fix ? fixesApplied : undefined,
    filesModified: fix && filesModified.length > 0 ? Array.from(new Set(filesModified)) : undefined,
    diff: diffParts.length > 0 ? diffParts.join("\n\n") : undefined,
  };
}
