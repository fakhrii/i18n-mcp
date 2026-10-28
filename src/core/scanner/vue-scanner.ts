import type { DetectedString } from "../../models/scanner.js";
import { scanHtmlTemplateFile } from "./html-scanner.js";
import { scanSourceFileAst } from "./ast-scanner.js";
import type { I18nMcpConfig } from "../../models/config.js";

export interface VueScanOptions {
  filePath: string;
  sourceCode: string;
  knownNamespaces?: string[];
  config?: I18nMcpConfig | null;
  onlyUserFacing?: boolean;
  minConfidence?: number;
  ambiguousOnly?: boolean;
}

/**
 * Scans a Vue 3 / Nuxt Single File Component (.vue) for hardcoded strings across both
 * its <template> and <script> sections.
 */
export function scanVueSourceFile(options: VueScanOptions): DetectedString[] {
  const { sourceCode, filePath } = options;
  const results: DetectedString[] = [];

  // 1. Scan <template> block
  const templateMatch = sourceCode.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
  if (templateMatch && templateMatch.index !== undefined && templateMatch[1]) {
    const templateContent = templateMatch[1];
    const templateStartIndex = templateMatch.index + templateMatch[0].indexOf(templateContent);

    // Calculate line offset for template
    let templateLineOffset = 0;
    for (let i = 0; i < templateStartIndex; i++) {
      if (sourceCode[i] === "\n") templateLineOffset++;
    }

    const templateDetections = scanHtmlTemplateFile({
      ...options,
      sourceCode: templateContent,
    });

    for (const det of templateDetections) {
      results.push({
        ...det,
        line: det.line + templateLineOffset,
        id: `${filePath}:${det.line + templateLineOffset}:${det.column}`,
      });
    }
  }

  // 2. Scan <script> / <script setup> block
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;

  while ((scriptMatch = scriptRegex.exec(sourceCode)) !== null) {
    const scriptContent = scriptMatch[2];
    if (!scriptContent || scriptContent.trim().length === 0) continue;

    const scriptStartIndex = scriptMatch.index + scriptMatch[0].indexOf(scriptContent);
    let scriptLineOffset = 0;
    for (let i = 0; i < scriptStartIndex; i++) {
      if (sourceCode[i] === "\n") scriptLineOffset++;
    }

    const scriptDetections = scanSourceFileAst({
      ...options,
      sourceCode: scriptContent,
    });

    for (const det of scriptDetections) {
      results.push({
        ...det,
        line: det.line + scriptLineOffset,
        id: `${filePath}:${det.line + scriptLineOffset}:${det.column}`,
      });
    }
  }

  return results;
}
