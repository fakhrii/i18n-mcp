import type { AstContextType, DetectedString } from "../../models/scanner.js";
import { classifyString, computeSemanticRole } from "../classifier/classifier.js";
import { generateSemanticKey } from "../keys/key-generator.js";
import { resolveSuggestedNamespace } from "../namespace/namespace-resolver.js";
import { getFrameworkAdapter } from "../../integrations/adapters/index.js";
import type { I18nMcpConfig } from "../../models/config.js";

export interface HtmlScanOptions {
  filePath: string;
  sourceCode: string;
  knownNamespaces?: string[];
  config?: I18nMcpConfig | null;
  onlyUserFacing?: boolean;
  minConfidence?: number;
  ambiguousOnly?: boolean;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function computeLineAndCol(
  code: string,
  offset: number
): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  const column = offset - lastNewline;
  return { line, column };
}

interface ParsedInterpolation {
  templateText: string;
  variables: string[];
  variableExpressions: Record<string, string>;
  isAlreadyTranslated: boolean;
}

function parseHtmlInterpolations(text: string): ParsedInterpolation {
  const variables: string[] = [];
  const variableExpressions: Record<string, string> = {};
  let isAlreadyTranslated = false;

  const regex = /\{\{([^}]+)\}\}/g;
  let hasInterpolation = false;

  const templateText = text.replace(regex, (_full, expr: string) => {
    hasInterpolation = true;
    const trimmedExpr = expr.trim();
    if (
      trimmedExpr.includes("| translate") ||
      trimmedExpr.includes("| transloco") ||
      trimmedExpr.includes("translate.instant")
    ) {
      isAlreadyTranslated = true;
      return "";
    }

    // Extract identifier: e.g. "user.name" -> "name", "items.length" -> "count"
    const segments = trimmedExpr
      .split(/[.[\]\s]/)
      .filter(Boolean)
      .map((s) => s.replace(/[^a-zA-Z0-9_]/g, ""))
      .filter(Boolean);
    let varName = segments.length > 0 ? segments[segments.length - 1]! : "val";
    if (varName.toLowerCase() === "length" || varName.toLowerCase() === "count") {
      varName = "count";
    }

    // Unique variable name if collision
    let uniqueName = varName;
    let suffix = 1;
    while (variables.includes(uniqueName) && variableExpressions[uniqueName] !== trimmedExpr) {
      uniqueName = `${varName}${suffix++}`;
    }

    if (!variables.includes(uniqueName)) {
      variables.push(uniqueName);
      variableExpressions[uniqueName] = trimmedExpr;
    }

    return `{{${uniqueName}}}`;
  });

  return {
    templateText: hasInterpolation ? templateText : text,
    variables,
    variableExpressions,
    isAlreadyTranslated,
  };
}

interface TagFrame {
  tagName: string;
  hasTranslateDirective: boolean;
}

export function scanHtmlTemplateFile(options: HtmlScanOptions): DetectedString[] {
  const {
    filePath,
    sourceCode,
    knownNamespaces = ["common"],
    config,
    onlyUserFacing = true,
    minConfidence = 0.0,
    ambiguousOnly = false,
  } = options;

  const results: DetectedString[] = [];
  const adapter = getFrameworkAdapter("angular");
  const len = sourceCode.length;
  let i = 0;

  const tagStack: TagFrame[] = [];

  function addCandidate(params: {
    startOffset: number;
    endOffset: number;
    text: string;
    rawText: string;
    astType: AstContextType;
    propName?: string;
    componentName?: string;
    variables?: string[];
    variableExpressions?: Record<string, string>;
  }): void {
    const {
      startOffset,
      endOffset,
      text,
      rawText,
      astType,
      propName,
      componentName,
      variables,
      variableExpressions,
    } = params;

    const trimmed = text.trim();
    if (!trimmed) return;

    const classificationResult = classifyString({
      text: trimmed,
      astType,
      propName,
      componentName,
      filePath,
    });

    const semanticRole =
      classificationResult.semanticRole ??
      computeSemanticRole(
        classificationResult.isUserFacing,
        classificationResult.confidence
      );

    if (ambiguousOnly && semanticRole !== "AMBIGUOUS") {
      return;
    }

    if (onlyUserFacing && !classificationResult.isUserFacing) {
      return;
    }

    if (classificationResult.confidence < minConfidence) {
      return;
    }

    const { line: startLine, column: startCol } = computeLineAndCol(sourceCode, startOffset);
    const { line: endLine, column: endCol } = computeLineAndCol(sourceCode, endOffset);

    const suggestedKey = generateSemanticKey(trimmed, propName || componentName);
    const suggestedNamespace = resolveSuggestedNamespace(
      filePath,
      trimmed,
      knownNamespaces,
      config
    );

    const candidateId = `${filePath}:${startLine}:${startCol}`;

    results.push({
      id: candidateId,
      file: filePath,
      line: startLine,
      column: startCol,
      endLine,
      endColumn: endCol,
      text: trimmed,
      rawText,
      type: astType,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      confidenceLevel: classificationResult.confidenceLevel,
      semanticRole,
      suggestedNamespace,
      suggestedKey,
      reason: classificationResult.reason,
      ...(componentName ? { componentName } : {}),
      ...(propName ? { propName } : {}),
      ...(variables && variables.length > 0 ? { variables } : {}),
      ...(variableExpressions && Object.keys(variableExpressions).length > 0
        ? { variableExpressions }
        : {}),
    });
  }

  while (i < len) {
    // 1. Skip comments: <!-- ... -->
    if (sourceCode.startsWith("<!--", i)) {
      const endComment = sourceCode.indexOf("-->", i + 4);
      if (endComment === -1) {
        break;
      }
      i = endComment + 3;
      continue;
    }

    // 2. Skip <script> and <style>
    const scriptMatch = sourceCode.slice(i).match(/^<(script|style)\b[^>]*>/i);
    if (scriptMatch) {
      const tagName = scriptMatch[1]!.toLowerCase();
      const openTagLen = scriptMatch[0].length;
      const closeTagStr = `</${tagName}>`;
      const closeIndex = sourceCode.toLowerCase().indexOf(closeTagStr, i + openTagLen);
      if (closeIndex === -1) {
        break;
      }
      i = closeIndex + closeTagStr.length;
      continue;
    }

    // 3. Closing tag: </tagName>
    if (sourceCode.startsWith("</", i)) {
      const endTag = sourceCode.indexOf(">", i + 2);
      if (endTag === -1) break;
      const closingTagName = sourceCode
        .slice(i + 2, endTag)
        .trim()
        .toLowerCase()
        .split(/\s/)[0];

      // Pop matching tag from stack
      for (let s = tagStack.length - 1; s >= 0; s--) {
        if (tagStack[s]?.tagName === closingTagName) {
          tagStack.splice(s, 1);
          break;
        }
      }

      i = endTag + 1;
      continue;
    }

    // 4. Opening or self-closing tag: <tagName ...>
    if (sourceCode[i] === "<" && /[a-zA-Z]/.test(sourceCode[i + 1] || "")) {
      const tagEnd = sourceCode.indexOf(">", i + 1);
      if (tagEnd === -1) break;

      const tagContent = sourceCode.slice(i + 1, tagEnd);
      const isSelfClosing = tagContent.endsWith("/") || VOID_ELEMENTS.has(tagContent.split(/\s/)[0]!.toLowerCase());
      const rawTagName = tagContent.split(/\s/)[0]!.replace(/\/$/, "");
      const tagName = rawTagName.toLowerCase();

      let hasTranslateDirective = false;

      // Check for translate directive attribute: translate or [translate]
      if (/\b(?:translate|\[translate\])\b/.test(tagContent)) {
        hasTranslateDirective = true;
      }

      // Parse attributes inside this tag
      // Matches: attrName="val", attrName='val'
      const attrRegex = /([a-zA-Z0-9_\-.*:[\]()]+)\s*=\s*(["'])([\s\S]*?)\2/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(tagContent)) !== null) {
        const fullAttrMatch = attrMatch[0];
        const attrName = attrMatch[1]!;
        const quote = attrMatch[2]!;
        const attrValue = attrMatch[3]!;

        // If attribute indicates translation binding, e.g. [placeholder]="'KEY' | translate"
        if (
          attrValue.includes("| translate") ||
          attrValue.includes("| transloco") ||
          attrName === "translate" ||
          attrName === "[translate]"
        ) {
          hasTranslateDirective = true;
          continue;
        }

        // Check if attribute is known text prop
        if (adapter.isKnownTextProp(attrName) && !attrName.startsWith("[")) {
          // Calculate exact offsets of the quoted value
          const valueOffsetInTag = attrMatch.index + fullAttrMatch.indexOf(quote);
          const valueStartOffset = i + 1 + valueOffsetInTag;
          const valueEndOffset = valueStartOffset + attrValue.length + 2; // includes quotes
          const rawQuotedValue = sourceCode.slice(valueStartOffset, valueEndOffset);

          addCandidate({
            startOffset: valueStartOffset,
            endOffset: valueEndOffset,
            text: attrValue,
            rawText: rawQuotedValue,
            astType: "JSX_ATTRIBUTE",
            propName: attrName,
            componentName: rawTagName,
          });
        }
      }

      if (!isSelfClosing && !VOID_ELEMENTS.has(tagName)) {
        tagStack.push({
          tagName,
          hasTranslateDirective,
        });
      }

      i = tagEnd + 1;
      continue;
    }

    // 5. Text node between tags: text up to next '<'
    const nextTag = sourceCode.indexOf("<", i);
    const textEnd = nextTag === -1 ? len : nextTag;
    const rawTextSlice = sourceCode.slice(i, textEnd);

    if (rawTextSlice.trim()) {
      const currentFrame = tagStack[tagStack.length - 1];
      const hasTranslate = tagStack.some((f) => f.hasTranslateDirective);

      if (!hasTranslate) {
        // Find non-whitespace start
        const leadingWs = rawTextSlice.search(/\S/);
        const trimmedSlice = rawTextSlice.trim();

        // Check if text is already translated with translate pipe
        const interp = parseHtmlInterpolations(trimmedSlice);
        if (!interp.isAlreadyTranslated) {
          const textStartOffset = i + leadingWs;
          const textEndOffset = textStartOffset + trimmedSlice.length;

          addCandidate({
            startOffset: textStartOffset,
            endOffset: textEndOffset,
            text: interp.templateText,
            rawText: trimmedSlice,
            astType: "JSX_TEXT",
            componentName: currentFrame?.tagName || "div",
            variables: interp.variables,
            variableExpressions: interp.variableExpressions,
          });
        }
      }
    }

    i = textEnd;
  }

  return results;
}
