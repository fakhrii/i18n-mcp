import * as path from "node:path";
import type { RtlAuditOptions, RtlAuditResult, RtlIssue } from "../../models/rtl.js";
import { analyzeProject } from "../discovery/project-analyzer.js";
import { resolveProjectFiles } from "../scope/scope-resolver.js";
import { loadProjectConfig } from "../../config/config-loader.js";
import { readTextFile, writeTextFile, toPosixPath } from "../../utils/file-system.js";
import { generateUnifiedDiff } from "../replacement/diff-generator.js";
import { logger } from "../../utils/logger.js";

export const RTL_LOCALE_CODES = new Set([
  "ar",
  "he",
  "iw",
  "fa",
  "ur",
  "yi",
  "ps",
  "ku",
  "ckb",
  "sd",
  "ug",
  "dv",
]);

export function isRtlLocale(locale: string): boolean {
  if (!locale) return false;
  const base = locale.toLowerCase().split(/[-_]/)[0];
  return Boolean(base && RTL_LOCALE_CODES.has(base));
}

interface ReplacementChunk {
  start: number;
  end: number;
  replacement: string;
}

function computeLineAndCol(
  content: string,
  offset: number
): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (content[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

/**
 * Audits source code across frameworks for RTL and bidirectional layout compatibility.
 */
export async function auditRtlLayout(
  options: RtlAuditOptions = {}
): Promise<RtlAuditResult> {
  const projectRoot = path.resolve(options.projectPath || process.cwd());
  const analysis = await analyzeProject(projectRoot);
  const config = await loadProjectConfig(projectRoot);

  // 1. Detect RTL locales
  const targetLocales = options.targetLocales || analysis.i18n.targetLocales || [];
  const rtlLocalesDetected = targetLocales.filter((l): l is string => Boolean(l && isRtlLocale(l)));
  const isRtlTargeted = rtlLocalesDetected.length > 0;

  // 2. Resolve files
  const files = await resolveProjectFiles(projectRoot, options, config);
  const issues: RtlIssue[] = [];
  const filesWithReplacements = new Map<string, { original: string; chunks: ReplacementChunk[] }>();

  const isFlutter = analysis.framework === "flutter";
  const isReactNative = analysis.framework === "react-native";
  const isWeb = !isFlutter && !isReactNative;

  let hasI18nManagerUsage = false;
  let hasHtmlDirUsage = false;

  for (const relFile of files) {
    const absPath = path.join(projectRoot, relFile);
    const content = await readTextFile(absPath);
    if (!content) continue;

    const fileIssues: RtlIssue[] = [];
    const chunks: ReplacementChunk[] = [];
    const isDart = relFile.endsWith(".dart");
    let match: RegExpExecArray | null = null;

    if (content.includes("I18nManager")) {
      hasI18nManagerUsage = true;
    }
    if (content.includes('dir="') || content.includes("dir='") || content.includes("document.dir")) {
      hasHtmlDirUsage = true;
    }

    if (isDart) {
      // ----------------------------------------------------
      // Flutter / Dart Rules
      // ----------------------------------------------------

      // 1. EdgeInsets.only(left: ... / right: ...)
      const edgeInsetsRegex = /\bEdgeInsets\.only\s*\(\s*([^)]*?)\b(left|right)\s*:/g;
      while ((match = edgeInsetsRegex.exec(content)) !== null) {
        const prop = match[2];
        if (!prop) continue;
        const replacementProp = prop === "left" ? "start" : "end";
        const loc = computeLineAndCol(content, match.index);
        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_SPACING",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: `EdgeInsets.only(${prop}:)`,
          suggestedReplacement: `EdgeInsetsDirectional.only(${replacementProp}:)`,
          message: `Physical spacing '${prop}' breaks in RTL layouts. Use 'EdgeInsetsDirectional.only(${replacementProp}:)' instead.`,
          autoFixable: true,
        });

        const fullMatched = match[0];
        const fixedStr = fullMatched
          .replace("EdgeInsets.only", "EdgeInsetsDirectional.only")
          .replace(new RegExp(`\\b${prop}\\s*:`), `${replacementProp}:`);

        chunks.push({
          start: match.index,
          end: match.index + fullMatched.length,
          replacement: fixedStr,
        });
      }

      // 2. Alignment.centerLeft / centerRight / etc.
      const alignRegex = /\bAlignment\.(centerLeft|centerRight|topLeft|topRight|bottomLeft|bottomRight)\b/g;
      while ((match = alignRegex.exec(content)) !== null) {
        const alignVal = match[1];
        if (!alignVal) continue;
        const loc = computeLineAndCol(content, match.index);
        const directionalVal = alignVal
          .replace("Left", "Start")
          .replace("Right", "End");
        const replacement = `AlignmentDirectional.${directionalVal}`;

        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_ALIGNMENT",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: match[0],
          suggestedReplacement: replacement,
          message: `Physical alignment '${match[0]}' does not flip in RTL. Use '${replacement}' instead.`,
          autoFixable: true,
        });

        chunks.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement,
        });
      }

      // 3. Positioned(left: ... / right: ...)
      const positionedRegex = /\bPositioned\s*\(\s*([^)]*?)\b(left|right)\s*:/g;
      while ((match = positionedRegex.exec(content)) !== null) {
        const prop = match[2];
        if (!prop) continue;
        const replacementProp = prop === "left" ? "start" : "end";
        const loc = computeLineAndCol(content, match.index);
        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_POSITION",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: `Positioned(${prop}:)`,
          suggestedReplacement: `PositionedDirectional(${replacementProp}:)`,
          message: `Physical positioned coordinate '${prop}' breaks in RTL. Use 'PositionedDirectional(${replacementProp}:)' instead.`,
          autoFixable: true,
        });

        const fullMatched = match[0];
        const fixedStr = fullMatched
          .replace("Positioned", "PositionedDirectional")
          .replace(new RegExp(`\\b${prop}\\s*:`), `${replacementProp}:`);

        chunks.push({
          start: match.index,
          end: match.index + fullMatched.length,
          replacement: fixedStr,
        });
      }
    } else {
      // ----------------------------------------------------
      // React Native, React Web, Next.js, Angular, Vue Rules
      // ----------------------------------------------------

      // 1. Physical Margins & Paddings in Style Objects
      // e.g. marginLeft: 16, paddingRight: 20
      const styleSpacingRegex =
        /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeftWidth|borderRightWidth)\s*:\s*([^,\n}]+)/g;

      while ((match = styleSpacingRegex.exec(content)) !== null) {
        const prop = match[1];
        const value = match[2] ? match[2].trim() : "";
        if (!prop) continue;
        const loc = computeLineAndCol(content, match.index);

        let logicalProp = prop;
        if (isReactNative) {
          logicalProp = prop
            .replace("Left", "Start")
            .replace("Right", "End");
        } else {
          // Web logical CSS properties
          if (prop.startsWith("margin")) {
            logicalProp = prop.replace("marginLeft", "marginInlineStart").replace("marginRight", "marginInlineEnd");
          } else if (prop.startsWith("padding")) {
            logicalProp = prop.replace("paddingLeft", "paddingInlineStart").replace("paddingRight", "paddingInlineEnd");
          } else if (prop.startsWith("border")) {
            logicalProp = prop.replace("borderLeftWidth", "borderInlineStartWidth").replace("borderRightWidth", "borderInlineEndWidth");
          }
        }

        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_SPACING",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: `${prop}: ${value}`,
          suggestedReplacement: `${logicalProp}: ${value}`,
          message: `Physical property '${prop}' does not adapt to RTL. Use '${logicalProp}' instead.`,
          autoFixable: true,
        });

        chunks.push({
          start: match.index,
          end: match.index + prop.length,
          replacement: logicalProp,
        });
      }

      // 2. Physical Border Radius in React Native
      // e.g. borderTopLeftRadius -> borderTopStartRadius
      const borderRadiusRegex =
        /\b(borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\s*:\s*([^,\n}]+)/g;
      while ((match = borderRadiusRegex.exec(content)) !== null) {
        const prop = match[1];
        const value = match[2] ? match[2].trim() : "";
        if (!prop) continue;
        const loc = computeLineAndCol(content, match.index);

        const logicalProp = prop
          .replace("Left", "Start")
          .replace("Right", "End");

        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_SPACING",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: `${prop}: ${value}`,
          suggestedReplacement: `${logicalProp}: ${value}`,
          message: `Corner radius '${prop}' breaks corner symmetry in RTL. Use '${logicalProp}' instead.`,
          autoFixable: true,
        });

        chunks.push({
          start: match.index,
          end: match.index + prop.length,
          replacement: logicalProp,
        });
      }

      // 3. Physical Text Alignment
      // e.g. textAlign: 'left' / 'right'
      const textAlignRegex = /\btextAlign\s*:\s*(['"`])(left|right)\1/g;
      while ((match = textAlignRegex.exec(content)) !== null) {
        const quote = match[1];
        const dir = match[2];
        if (!quote || !dir) continue;
        const loc = computeLineAndCol(content, match.index);

        const logicalDir = isReactNative
          ? dir === "left" ? "auto" : "right"
          : dir === "left" ? "start" : "end";

        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_ALIGNMENT",
          severity: isRtlTargeted ? "error" : "warning",
          propertyOrText: `textAlign: ${quote}${dir}${quote}`,
          suggestedReplacement: `textAlign: ${quote}${logicalDir}${quote}`,
          message: `Hardcoded '${dir}' text alignment prevents automatic RTL mirroring. Use '${logicalDir}' instead.`,
          autoFixable: true,
        });

        chunks.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: `textAlign: ${quote}${logicalDir}${quote}`,
        });
      }

      // 4. Physical Positioning in Style Objects
      // e.g. left: 10, right: 0
      const stylePositionRegex = /\b(?<![\w-])(left|right)\s*:\s*([0-9]+(?:\.[0-9]+)?|['"`][^'"`]+['"`])/g;
      while ((match = stylePositionRegex.exec(content)) !== null) {
        const prop = match[1];
        const val = match[2];
        if (!prop || !val) continue;
        const loc = computeLineAndCol(content, match.index);

        const logicalProp = isReactNative
          ? prop === "left" ? "start" : "end"
          : prop === "left" ? "insetInlineStart" : "insetInlineEnd";

        fileIssues.push({
          id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
          file: toPosixPath(relFile),
          line: loc.line,
          column: loc.column,
          category: "PHYSICAL_POSITION",
          severity: "info",
          propertyOrText: `${prop}: ${val}`,
          suggestedReplacement: `${logicalProp}: ${val}`,
          message: `Physical coordinate '${prop}' might not flip in RTL layouts. Consider '${logicalProp}: ${val}'.`,
          autoFixable: true,
        });

        chunks.push({
          start: match.index,
          end: match.index + prop.length,
          replacement: logicalProp,
        });
      }

      // 5. Tailwind CSS Physical Utility Classes in class / className
      // e.g. className="ml-4 mr-2 pl-3 text-left"
      const tailwindClassRegex = /\b(?:class|className)\s*=\s*(['"`])([^'"`]+)\1/g;
      while ((match = tailwindClassRegex.exec(content)) !== null) {
        const fullClassAttr = match[0];
        const quote = match[1];
        const rawClassVal = match[2];
        if (!quote || !rawClassVal) continue;

        const classList = rawClassVal.split(/\s+/);
        let hasModifiedClass = false;
        const newClassList: string[] = [];

        for (const cls of classList) {
          let replacedCls = cls;
          if (/^ml-(\d+|auto|px)$/.test(cls)) {
            replacedCls = cls.replace("ml-", "ms-");
          } else if (/^mr-(\d+|auto|px)$/.test(cls)) {
            replacedCls = cls.replace("mr-", "me-");
          } else if (/^pl-(\d+|px)$/.test(cls)) {
            replacedCls = cls.replace("pl-", "ps-");
          } else if (/^pr-(\d+|px)$/.test(cls)) {
            replacedCls = cls.replace("pr-", "pe-");
          } else if (cls === "text-left") {
            replacedCls = "text-start";
          } else if (cls === "text-right") {
            replacedCls = "text-end";
          } else if (/^left-(\d+|auto|full|px)$/.test(cls)) {
            replacedCls = cls.replace("left-", "start-");
          } else if (/^right-(\d+|auto|full|px)$/.test(cls)) {
            replacedCls = cls.replace("right-", "end-");
          }

          if (replacedCls !== cls) {
            hasModifiedClass = true;
            const loc = computeLineAndCol(content, match.index);
            fileIssues.push({
              id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
              file: toPosixPath(relFile),
              line: loc.line,
              column: loc.column,
              category: "PHYSICAL_SPACING",
              severity: isRtlTargeted ? "error" : "warning",
              propertyOrText: cls,
              suggestedReplacement: replacedCls,
              message: `Physical Tailwind utility '${cls}' breaks in RTL. Use '${replacedCls}' instead.`,
              autoFixable: true,
            });
          }
          newClassList.push(replacedCls);
        }

        if (hasModifiedClass) {
          const attrName = fullClassAttr.startsWith("class=") ? "class=" : "className=";
          const replacementAttr = `${attrName}${quote}${newClassList.join(" ")}${quote}`;
          chunks.push({
            start: match.index,
            end: match.index + fullClassAttr.length,
            replacement: replacementAttr,
          });
        }
      }
    }

    // ----------------------------------------------------
    // Common Rules (Directional Icons & Text Arrows)
    // ----------------------------------------------------

    // 1. Directional Icons (chevron-right, arrow-forward, etc.)
    const directionalIconRegex =
      /\b(?:name|icon)\s*=\s*(['"`])([a-zA-Z0-9_-]*(?:chevron-right|chevron-left|arrow-forward|arrow-back|arrow-right|arrow-left)[a-zA-Z0-9_-]*)\1/g;
    while ((match = directionalIconRegex.exec(content)) !== null) {
      const iconName = match[2];
      if (!iconName) continue;
      const loc = computeLineAndCol(content, match.index);
      fileIssues.push({
        id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
        file: toPosixPath(relFile),
        line: loc.line,
        column: loc.column,
        category: "DIRECTIONAL_ICON",
        severity: "warning",
        propertyOrText: iconName,
        message: `Directional icon '${iconName}' points in a physical direction and must be mirrored or flipped in RTL.`,
        autoFixable: false,
      });
    }

    // 2. Embedded Arrow Glyphs in UI text
    const directionalGlyphRegex = /(?:>|→|←|<|->|<-)\s*(?:Next|Previous|Back|Forward|Continue)|(?:Next|Previous|Back|Forward|Continue)\s*(?:>|→|←|<|->|<-)/gi;
    while ((match = directionalGlyphRegex.exec(content)) !== null) {
      const loc = computeLineAndCol(content, match.index);
      fileIssues.push({
        id: `${toPosixPath(relFile)}:${loc.line}:${loc.column}`,
        file: toPosixPath(relFile),
        line: loc.line,
        column: loc.column,
        category: "DIRECTIONAL_GLYPH",
        severity: "warning",
        propertyOrText: match[0],
        message: `Directional text '${match[0]}' has embedded physical arrows. In RTL languages, directional symbols must point in the reading direction.`,
        autoFixable: false,
      });
    }

    if (fileIssues.length > 0) {
      issues.push(...fileIssues);
    }

    if (chunks.length > 0) {
      filesWithReplacements.set(absPath, { original: content, chunks });
    }
  }

  // ----------------------------------------------------
  // Root RTL Framework Architecture Checks
  // ----------------------------------------------------
  if (isRtlTargeted) {
    if (isReactNative && !hasI18nManagerUsage) {
      issues.push({
        id: "project:root",
        file: "package.json",
        line: 1,
        column: 1,
        category: "MISSING_RTL_SUPPORT",
        severity: "error",
        propertyOrText: "I18nManager",
        message: `Project targets RTL locales [${rtlLocalesDetected.join(", ")}], but 'I18nManager.allowRTL(true)' or 'I18nManager.isRTL' was not detected in project sources.`,
        autoFixable: false,
      });
    }

    if (isWeb && !hasHtmlDirUsage) {
      issues.push({
        id: "project:root",
        file: "index.html",
        line: 1,
        column: 1,
        category: "MISSING_RTL_SUPPORT",
        severity: "warning",
        propertyOrText: 'dir="rtl"',
        message: `Project targets RTL locales [${rtlLocalesDetected.join(", ")}], but dynamic 'dir' attribute (e.g. dir="rtl" or dir="auto") was not detected in HTML or layout templates.`,
        autoFixable: false,
      });
    }
  }

  // ----------------------------------------------------
  // Apply Auto-Fixes if requested
  // ----------------------------------------------------
  const shouldFix = Boolean(options.fix);
  const dryRun = options.dryRun ?? true;
  let fixesApplied = 0;
  const diffs: string[] = [];
  const filesAffected: string[] = [];

  for (const [absFile, { original, chunks }] of filesWithReplacements.entries()) {
    // Sort chunks descending by offset to maintain index stability
    chunks.sort((a, b) => b.start - a.start);

    let modified = original;
    for (const chunk of chunks) {
      modified =
        modified.slice(0, chunk.start) +
        chunk.replacement +
        modified.slice(chunk.end);
      fixesApplied++;
    }

    if (modified !== original) {
      const diff = generateUnifiedDiff(absFile, original, modified);
      if (diff) diffs.push(diff);
      filesAffected.push(absFile);

      if (shouldFix && !dryRun) {
        await writeTextFile(absFile, modified);
      }
    }
  }

  const fixableCount = issues.filter((i) => i.autoFixable).length;

  logger.info(
    `RTL Audit complete: ${issues.length} issues found (${fixableCount} auto-fixable), ${filesAffected.length} files affected`
  );

  return {
    isRtlTargeted,
    rtlLocalesDetected,
    totalIssues: issues.length,
    fixableCount,
    issues,
    filesAffected,
    fixesApplied: shouldFix ? fixesApplied : undefined,
    diff: diffs.join("\n"),
  };
}
