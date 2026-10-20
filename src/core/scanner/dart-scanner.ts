import type { AstContextType, DetectedString } from "../../models/scanner.js";
import { classifyString } from "../classifier/classifier.js";
import { generateSemanticKey } from "../keys/key-generator.js";
import { isCountIdentifier, derivePluralForms } from "../plural/plural-helper.js";
import type { I18nMcpConfig } from "../../models/config.js";

export interface DartScanOptions {
  filePath: string;
  sourceCode: string;
  knownNamespaces?: string[];
  config?: I18nMcpConfig | null;
  onlyUserFacing?: boolean;
  minConfidence?: number;
  ambiguousOnly?: boolean;
}

const FLUTTER_TEXT_PROPS = new Set([
  "title",
  "label",
  "labeltext",
  "hinttext",
  "helpertext",
  "errortext",
  "tooltip",
  "semanticslabel",
  "message",
  "text",
  "buttontext",
]);

const FLUTTER_WIDGET_NAMES = new Set([
  "text",
  "textspan",
  "selectabletext",
  "richtext",
  "appbar",
  "elevatedbutton",
  "textbutton",
  "outlinedbutton",
  "snackbar",
  "alertdialog",
]);

interface DartStringMatch {
  raw: string;
  content: string;
  startOffset: number;
  endOffset: number;
  quoteType: string;
  isRaw: boolean;
}

function findDartStrings(code: string): DartStringMatch[] {
  const matches: DartStringMatch[] = [];
  const len = code.length;
  let i = 0;

  while (i < len) {
    // Skip line comments
    if (code[i] === "/" && code[i + 1] === "/") {
      i += 2;
      while (i < len && code[i] !== "\n") i++;
      continue;
    }

    // Skip block comments
    if (code[i] === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // Check for raw string prefix r'...' or r"..."
    let isRaw = false;
    if (code[i] === "r" && (code[i + 1] === "'" || code[i + 1] === '"')) {
      isRaw = true;
      i++;
    }

    // Check for string start: triple or single quotes
    if (code[i] === "'" || code[i] === '"') {
      const q = code[i]!;
      const isTriple =
        i + 2 < len && code[i + 1] === q && code[i + 2] === q;
      const startOffset = isRaw ? i - 1 : i;
      const quoteLen = isTriple ? 3 : 1;
      i += quoteLen;

      let content = "";
      while (i < len) {
        if (!isRaw && code[i] === "\\") {
          // Escaped dollar sign: preserve backslash so interpolation parser does not treat it as a variable
          if (code[i + 1] === "$") {
            content += "\\$";
            i += 2;
            continue;
          }
          // Escaped character
          content += code[i + 1] || "";
          i += 2;
          continue;
        }

        if (isTriple) {
          if (
            i + 2 < len &&
            code[i] === q &&
            code[i + 1] === q &&
            code[i + 2] === q
          ) {
            break;
          }
        } else {
          if (code[i] === q) {
            break;
          }
        }

        content += code[i];
        i++;
      }

      i += quoteLen; // skip closing quote(s)
      const endOffset = i;

      matches.push({
        raw: code.slice(startOffset, endOffset),
        content,
        startOffset,
        endOffset,
        quoteType: q,
        isRaw,
      });
      continue;
    }

    i++;
  }

  return matches;
}

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

function parseDartInterpolations(content: string): {
  templateText: string;
  variables: string[];
  variableExpressions: Record<string, string>;
  isPlural: boolean;
  pluralVariable?: string;
  pluralForm?: { one: string; other: string };
} {
  const variables: string[] = [];
  const variableExpressions: Record<string, string> = {};

  // Match unescaped ${expression} or $identifier (using negative lookbehind for \)
  const regex = /(?<!\\)(?:\$\{([^}]+)\}|\$([a-zA-Z_][a-zA-Z0-9_]*))/g;
  let templateText = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    templateText += content.slice(lastIndex, match.index);
    const exprText = (match[1] || match[2] || "").trim();

    let varName = exprText;
    if (exprText.includes(".")) {
      const parts = exprText.split(".");
      const prop = parts[parts.length - 1]!;
      if (isCountIdentifier(prop, exprText)) {
        varName = "count";
      } else {
        varName = prop;
      }
    }

    // Clean varName
    varName = varName.replace(/[^a-zA-Z0-9_]/g, "");
    if (!varName) varName = "val";

    variables.push(varName);
    variableExpressions[varName] = exprText;
    templateText += `{{${varName}}}`;
    lastIndex = regex.lastIndex;
  }

  templateText += content.slice(lastIndex);
  // Unescape literal \$ -> $
  templateText = templateText.replace(/\\(\$)/g, "$1");

  let isPlural = false;
  let pluralVariable: string | undefined;
  let pluralForm: { one: string; other: string } | undefined;

  if (variables.includes("count")) {
    const forms = derivePluralForms(templateText, "count");
    if (forms.one !== forms.other) {
      isPlural = true;
      pluralVariable = "count";
      pluralForm = forms;
    }
  }

  return {
    templateText,
    variables,
    variableExpressions,
    isPlural,
    pluralVariable,
    pluralForm,
  };
}

export function scanDartSourceFile(options: DartScanOptions): DetectedString[] {
  const {
    filePath,
    sourceCode,
    onlyUserFacing = true,
    minConfidence = 0.0,
    ambiguousOnly = false,
  } = options;

  const results: DetectedString[] = [];
  const strMatches = findDartStrings(sourceCode);

  for (const m of strMatches) {
    const rawTrimmed = m.content.trim();
    if (!rawTrimmed) continue;

    // Check context before string offset to detect widget or property
    const prefixContext = sourceCode.slice(Math.max(0, m.startOffset - 120), m.startOffset).trim();
    const linePrefix = prefixContext.split("\n").pop() || "";

    // 1. Skip imports, exports, parts
    if (/^\s*(import|export|part)\s+/.test(linePrefix)) {
      continue;
    }

    // 2. Skip logging & debugging calls
    if (/(print|log|debugPrint|developer\.log)\s*\(\s*$/.test(linePrefix)) {
      continue;
    }

    // 3. Skip Key constructor e.g. Key('home_screen')
    if (/\bKey\s*\(\s*$/.test(linePrefix)) {
      continue;
    }

    // 4. Skip common asset or technical patterns
    if (
      m.content.startsWith("package:") ||
      m.content.startsWith("assets/") ||
      m.content.startsWith("http://") ||
      m.content.startsWith("https://") ||
      m.content.endsWith(".png") ||
      m.content.endsWith(".svg") ||
      m.content.endsWith(".jpg") ||
      m.content.endsWith(".json")
    ) {
      continue;
    }

    // Determine surrounding Widget or Prop context
    let componentName: string | undefined;
    let propName: string | undefined;
    let astType: AstContextType = "STRING_LITERAL";

    // Check for Text('...') or TextSpan(text: '...') - supports single and multiline
    const textWidgetMatch =
      linePrefix.match(/\b([A-Z][a-zA-Z0-9_]*)\s*\(\s*$/) ||
      prefixContext.match(/\b([A-Z][a-zA-Z0-9_]*)\s*\(\s*$/);
    if (textWidgetMatch && textWidgetMatch[1]) {
      const widget = textWidgetMatch[1];
      if (FLUTTER_WIDGET_NAMES.has(widget.toLowerCase()) || widget.endsWith("Text") || widget.endsWith("Button")) {
        componentName = widget;
        astType = "JSX_TEXT"; // mapped to text sink
      }
    }

    // Check for prop: '...' (e.g. title: '...', hintText: '...') - supports single and multiline
    const propMatch =
      linePrefix.match(/\b([a-zA-Z0-9_]+)\s*:\s*$/) ||
      prefixContext.match(/\b([a-zA-Z0-9_]+)\s*:\s*$/);
    if (propMatch && propMatch[1]) {
      const prop = propMatch[1];
      propName = prop;
      astType = "JSX_ATTRIBUTE"; // mapped to attribute
      if (FLUTTER_TEXT_PROPS.has(prop.toLowerCase())) {
        astType = "JSX_TEXT";
      }
    }

    // Parse Dart string interpolations
    const interp = parseDartInterpolations(m.content);
    const displayText = interp.templateText;

    if (interp.variables.length > 0) {
      astType = "TEMPLATE_LITERAL";
    }

    const { line, column } = computeLineAndCol(sourceCode, m.startOffset);
    const endPos = computeLineAndCol(sourceCode, m.endOffset);

    // Classify string
    const classificationResult = classifyString({
      text: displayText,
      propName,
      componentName,
      astType,
      filePath,
    });

    if (onlyUserFacing && !classificationResult.isUserFacing) {
      continue;
    }

    if (classificationResult.confidence < minConfidence) {
      continue;
    }

    const semanticRole = classificationResult.isUserFacing
      ? classificationResult.confidence >= 0.8
        ? "CONFIRMED_UI"
        : "AMBIGUOUS"
      : "CONFIRMED_TECHNICAL";

    if (ambiguousOnly && semanticRole !== "AMBIGUOUS") {
      continue;
    }

    // Flutter keys use lowerCamelCase convention
    const suggestedKey = generateSemanticKey(
      displayText,
      propName || componentName,
      "lowerCamelCase"
    );

    results.push({
      id: `${filePath}:${line}:${column}`,
      file: filePath,
      line,
      column,
      endLine: endPos.line,
      endColumn: endPos.column,
      text: displayText,
      rawText: m.raw,
      type: astType,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      confidenceLevel: classificationResult.confidenceLevel,
      semanticRole,
      suggestedNamespace: "app_en",
      suggestedKey,
      reason: classificationResult.reason || "Flutter UI widget text",
      ...(componentName ? { componentName } : {}),
      ...(propName ? { propName } : {}),
      ...(interp.variables.length > 0 ? { variables: interp.variables } : {}),
      ...(Object.keys(interp.variableExpressions).length > 0
        ? { variableExpressions: interp.variableExpressions }
        : {}),
      ...(interp.isPlural
        ? {
            isPlural: true,
            pluralVariable: interp.pluralVariable,
            pluralForm: interp.pluralForm,
          }
        : {}),
    });
  }

  return results;
}
