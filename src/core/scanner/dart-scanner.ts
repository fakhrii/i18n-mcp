import type { AstContextType, DetectedString } from "../../models/scanner.js";
import { classifyString, isOnlyVariablesAndPunctuation, isMaskOrPlaceholderPattern } from "../classifier/classifier.js";
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
          if (code[i + 1] === "n") {
            content += "\n";
            i += 2;
            continue;
          }
          if (code[i + 1] === "t") {
            content += "\t";
            i += 2;
            continue;
          }
          if (code[i + 1] === "r") {
            content += "\r";
            i += 2;
            continue;
          }
          if (code[i + 1] === "u") {
            if (code[i + 2] === "{") {
              const closeBrace = code.indexOf("}", i + 3);
              if (closeBrace !== -1) {
                const hex = code.slice(i + 3, closeBrace);
                const codePoint = parseInt(hex, 16);
                if (!isNaN(codePoint)) {
                  content += String.fromCodePoint(codePoint);
                  i = closeBrace + 1;
                  continue;
                }
              }
            } else {
              const hex = code.slice(i + 2, i + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                const codePoint = parseInt(hex, 16);
                content += String.fromCodePoint(codePoint);
                i += 6;
                continue;
              }
            }
          }
          // Escaped character (quotes, backslash, etc.)
          content += code[i + 1] || "";
          i += 2;
          continue;
        }

        // Dart string interpolation handling with nested braces and nested quotes
        if (!isRaw && code[i] === "$") {
          if (code[i + 1] === "{") {
            let expr = "${";
            i += 2;
            let braceDepth = 1;

            while (i < len && braceDepth > 0) {
              // Line comment inside interpolation
              if (code[i] === "/" && code[i + 1] === "/") {
                while (i < len && code[i] !== "\n") {
                  expr += code[i];
                  i++;
                }
                continue;
              }
              // Block comment inside interpolation
              if (code[i] === "/" && code[i + 1] === "*") {
                expr += "/*";
                i += 2;
                while (i < len && !(code[i] === "*" && code[i + 1] === "/")) {
                  expr += code[i];
                  i++;
                }
                if (i < len) {
                  expr += "*/";
                  i += 2;
                }
                continue;
              }

              // Check for inner raw string
              let innerRaw = false;
              if (code[i] === "r" && (code[i + 1] === "'" || code[i + 1] === '"')) {
                innerRaw = true;
                expr += code[i];
                i++;
              }

              // Nested string literal inside interpolation
              if (code[i] === "'" || code[i] === '"') {
                const innerQ = code[i]!;
                const innerTriple =
                  i + 2 < len && code[i + 1] === innerQ && code[i + 2] === innerQ;
                const innerQuoteLen = innerTriple ? 3 : 1;
                expr += code.slice(i, i + innerQuoteLen);
                i += innerQuoteLen;

                while (i < len) {
                  if (!innerRaw && code[i] === "\\") {
                    expr += code[i] + (code[i + 1] || "");
                    i += 2;
                    continue;
                  }
                  if (innerTriple) {
                    if (
                      i + 2 < len &&
                      code[i] === innerQ &&
                      code[i + 1] === innerQ &&
                      code[i + 2] === innerQ
                    ) {
                      expr += code.slice(i, i + 3);
                      i += 3;
                      break;
                    }
                  } else if (code[i] === innerQ) {
                    expr += innerQ;
                    i++;
                    break;
                  }
                  expr += code[i];
                  i++;
                }
                continue;
              }

              // Braces in interpolation expression
              if (code[i] === "{") {
                braceDepth++;
              } else if (code[i] === "}") {
                braceDepth--;
              }

              expr += code[i];
              i++;
            }

            content += expr;
            continue;
          } else if (/[a-zA-Z_]/.test(code[i + 1] || "")) {
            // $identifier
            content += "$";
            i++;
            while (i < len && /[a-zA-Z0-9_]/.test(code[i] || "")) {
              content += code[i];
              i++;
            }
            continue;
          }
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

function buildLineStarts(code: string): number[] {
  const lineStarts = [0];
  const len = code.length;
  for (let i = 0; i < len; i++) {
    if (code[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function computeLineAndCol(
  lineStarts: number[],
  offset: number
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  let lineIdx = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lineStarts[mid]! <= offset) {
      lineIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const line = lineIdx + 1;
  const column = offset - lineStarts[lineIdx]! + 1;
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
  const len = content.length;
  let templateText = "";
  let i = 0;

  while (i < len) {
    if (content[i] === "\\" && content[i + 1] === "$") {
      templateText += "$";
      i += 2;
      continue;
    }

    if (content[i] === "$") {
      if (content[i + 1] === "{") {
        const startExpr = i + 2;
        let depth = 1;
        let j = startExpr;
        while (j < len && depth > 0) {
          if (content[j] === "\\" && j + 1 < len) {
            j += 2;
            continue;
          }
          if (content[j] === "'" || content[j] === '"') {
            const innerQ = content[j]!;
            j++;
            while (j < len && content[j] !== innerQ) {
              if (content[j] === "\\" && j + 1 < len) j += 2;
              else j++;
            }
            if (j < len) j++;
            continue;
          }
          if (content[j] === "{") depth++;
          else if (content[j] === "}") depth--;
          j++;
        }

        const exprText = content.slice(startExpr, j - 1).trim();
        i = j;

        let varName = "";
        if (exprText.includes(".")) {
          const parts = exprText.split(".");
          const prop = parts[parts.length - 1]!.replace(/[^a-zA-Z0-9_]/g, "");
          if (isCountIdentifier(prop, exprText)) {
            varName = "count";
          } else {
            varName = prop;
          }
        } else {
          const idMatch = exprText.match(/[a-zA-Z_][a-zA-Z0-9_]*/);
          varName = idMatch ? idMatch[0] : "val";
        }

        varName = varName.replace(/[^a-zA-Z0-9_]/g, "");
        if (!varName) varName = "val";

        let uniqueVarName = varName;
        let counter = 2;
        while (variables.includes(uniqueVarName) && variableExpressions[uniqueVarName] !== exprText) {
          uniqueVarName = `${varName}_${counter++}`;
        }

        if (!variables.includes(uniqueVarName)) {
          variables.push(uniqueVarName);
        }
        variableExpressions[uniqueVarName] = exprText;
        templateText += `{{${uniqueVarName}}}`;
        continue;
      } else if (/[a-zA-Z_]/.test(content[i + 1] || "")) {
        let j = i + 1;
        while (j < len && /[a-zA-Z0-9_]/.test(content[j] || "")) {
          j++;
        }
        const varName = content.slice(i + 1, j);
        i = j;

        if (!variables.includes(varName)) {
          variables.push(varName);
        }
        variableExpressions[varName] = varName;
        templateText += `{{${varName}}}`;
        continue;
      }
    }

    templateText += content[i];
    i++;
  }

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

export function isNonUiDartFile(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.toLowerCase().replace(/\\/g, "/");

  const nonUiDirectories = [
    "/constants/",
    "/constant/",
    "/data/",
    "/domain/",
    "/network/",
    "/http/",
    "/http_strategy_helper/",
    "/models/",
    "/remote_models/",
    "/local_models/",
    "/dto/",
    "/dtos/",
    "/entities/",
    "/datasources/",
    "/data_sources/",
    "/repositories/",
    "/repository_impl/",
    "/services/",
    "/service/",
    "/storage/",
    "/local_storage/",
    "/preferences/",
    "/database/",
    "/di/",
    "/injection/",
    "/migration/",
    "/migrations/",
    "/interceptors/",
    "/middleware/",
    "/config/",
    "/configurations/",
    "/routes/",
    "/enums/",
  ];

  for (const dir of nonUiDirectories) {
    if (normalized.includes(dir)) {
      return true;
    }
  }

  const fileName = normalized.split("/").pop() || "";
  if (fileName.includes("constant")) {
    return true;
  }

  const nonUiSuffixes = [
    "_model.dart",
    "_models.dart",
    "_entity.dart",
    "_entities.dart",
    "_dto.dart",
    "_dtos.dart",
    "_datasource.dart",
    "_datasource_impl.dart",
    "_datasources.dart",
    "_data_source.dart",
    "_data_sources.dart",
    "_repository.dart",
    "_repository_impl.dart",
    "_repositories.dart",
    "_strategy.dart",
    "_strategies.dart",
    "_strategy_helper.dart",
    "_service.dart",
    "_services.dart",
    "_service_impl.dart",
    "_interceptor.dart",
    "_interceptors.dart",
    "_migration.dart",
    "_migrations.dart",
    "_config.dart",
    "_endpoint.dart",
    "_endpoints.dart",
    "_route.dart",
    "_routes.dart",
    "_api.dart",
    "_apis.dart",
    "_event.dart",
    "_events.dart",
    "_state.dart",
  ];

  for (const suffix of nonUiSuffixes) {
    if (fileName.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

export interface DartScopeAnalysis {
  isSafeForLocalization: boolean;
  skipReason?: string;
  hasBuildContext: boolean;
  isInsideConst: boolean;
  isTopLevel: boolean;
  isClassField: boolean;
  isStatic: boolean;
  isParameterDefault: boolean;
  isAnnotation: boolean;
}

export function analyzeDartScope(
  sourceCode: string,
  startOffset: number,
  filePath: string,
  componentName?: string,
  propName?: string
): DartScopeAnalysis {
  if (isNonUiDartFile(filePath)) {
    return {
      isSafeForLocalization: false,
      skipReason: "Non-UI architecture file (no Flutter BuildContext)",
      hasBuildContext: false,
      isInsideConst: false,
      isTopLevel: false,
      isClassField: false,
      isStatic: false,
      isParameterDefault: false,
      isAnnotation: false,
    };
  }

  const prefix = sourceCode.slice(Math.max(0, startOffset - 250), startOffset);
  const linePrefix = prefix.split("\n").pop() || "";

  // 1. Check Annotations (@Route('home'), @JsonKey(name: '...'), @Default('...'))
  if (/@\s*[a-zA-Z0-9_]+(?:\s*\([^)]*)?$/.test(linePrefix)) {
    return {
      isSafeForLocalization: false,
      skipReason: "Annotation metadata is compile-time constant and not user-facing copy",
      hasBuildContext: false,
      isInsideConst: true,
      isTopLevel: false,
      isClassField: false,
      isStatic: false,
      isParameterDefault: false,
      isAnnotation: true,
    };
  }

  // 2. Check Constructor initializing formals (this.title = '...')
  if (/\bthis\.[a-zA-Z0-9_]+\s*=\s*$/.test(linePrefix)) {
    return {
      isSafeForLocalization: false,
      skipReason: "Default parameter values in Dart must be compile-time constants and cannot invoke localization",
      hasBuildContext: false,
      isInsideConst: true,
      isTopLevel: false,
      isClassField: false,
      isStatic: false,
      isParameterDefault: true,
      isAnnotation: false,
    };
  }

  // 3. Find preceding statement delimiter (;, {, or })
  let lastDelim = -1;
  for (let j = startOffset - 1; j >= 0; j--) {
    const ch = sourceCode[j];
    if (ch === ";" || ch === "{" || ch === "}") {
      lastDelim = j;
      break;
    }
  }
  const stmtPrefix = sourceCode.slice(Math.max(0, lastDelim + 1), startOffset).trim();

  // 4. Static declarations (static const, static final, static var, static String, etc.)
  if (/\bstatic\b/.test(stmtPrefix)) {
    return {
      isSafeForLocalization: false,
      skipReason: "Static declaration in Dart has no BuildContext and cannot safely invoke localization",
      hasBuildContext: false,
      isInsideConst: false,
      isTopLevel: false,
      isClassField: true,
      isStatic: true,
      isParameterDefault: false,
      isAnnotation: false,
    };
  }

  const isWidgetExpr = Boolean(
    componentName &&
      (FLUTTER_WIDGET_NAMES.has(componentName.toLowerCase()) ||
        componentName.endsWith("Text") ||
        componentName.endsWith("Button") ||
        componentName.endsWith("View") ||
        componentName.endsWith("Screen") ||
        componentName.endsWith("Dialog") ||
        componentName.endsWith("Bar"))
  );

  const isPropExpr = Boolean(propName && FLUTTER_TEXT_PROPS.has(propName.toLowerCase()));

  // 5. Const declarations (must remain compile-time constants unless it's a widget or UI prop that can be non-const)
  const isStmtConst = /\bconst\b/.test(stmtPrefix);
  if (isStmtConst && !isWidgetExpr && !isPropExpr) {
    return {
      isSafeForLocalization: false,
      skipReason: "Compile-time const declaration cannot contain dynamic localization calls",
      hasBuildContext: false,
      isInsideConst: true,
      isTopLevel: false,
      isClassField: false,
      isStatic: false,
      isParameterDefault: false,
      isAnnotation: false,
    };
  }

  // 6. AST braceDepth & enclosing class tracking
  let braceDepth = 0;
  let parenDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let stringQuote = "";

  let classDepth = -1;
  let currentClassHeader = "";
  let pendingClassHeader = "";

  for (let j = 0; j < startOffset; j++) {
    const c = sourceCode[j]!;
    const next = sourceCode[j + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        j++;
      }
      continue;
    }
    if (inString) {
      if (c === "\\" && next) {
        j++;
        continue;
      }
      if (c === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (c === "/" && next === "/") {
      inLineComment = true;
      j++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      j++;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringQuote = c;
      continue;
    }

    if (c === "(") {
      parenDepth++;
    } else if (c === ")") {
      if (parenDepth > 0) parenDepth--;
    } else if (c === "{") {
      braceDepth++;
      if (pendingClassHeader) {
        classDepth = braceDepth - 1;
        currentClassHeader = pendingClassHeader;
        pendingClassHeader = "";
      }
    } else if (c === "}") {
      if (classDepth !== -1 && braceDepth === classDepth + 1) {
        classDepth = -1;
        currentClassHeader = "";
      }
      if (braceDepth > 0) braceDepth--;
    } else {
      if (
        c === "c" &&
        sourceCode.slice(j, j + 5) === "class" &&
        /\s/.test(sourceCode[j + 5] || "")
      ) {
        const endHeader = sourceCode.indexOf("{", j);
        if (endHeader !== -1) {
          pendingClassHeader = sourceCode.slice(j, endHeader);
        }
      }
    }
  }

  // 6b. Parameter default value inside parameter list (parenDepth > 0)
  if (parenDepth > 0 && /(?:[a-zA-Z0-9_<>,?]+\s+[a-zA-Z0-9_]+)\s*=\s*$/.test(linePrefix)) {
    return {
      isSafeForLocalization: false,
      skipReason: "Default parameter values in Dart must be compile-time constants and cannot invoke localization",
      hasBuildContext: false,
      isInsideConst: true,
      isTopLevel: false,
      isClassField: false,
      isStatic: false,
      isParameterDefault: true,
      isAnnotation: false,
    };
  }

  // 7. Top-Level declarations (outside any class or function)
  if (braceDepth === 0) {
    if (isWidgetExpr || isPropExpr) {
      return {
        isSafeForLocalization: true,
        hasBuildContext: false,
        isInsideConst: isStmtConst,
        isTopLevel: true,
        isClassField: false,
        isStatic: false,
        isParameterDefault: false,
        isAnnotation: false,
      };
    }

    return {
      isSafeForLocalization: false,
      skipReason: "Top-level declaration in Dart has no BuildContext and runs before localization delegate loads",
      hasBuildContext: false,
      isInsideConst: isStmtConst,
      isTopLevel: true,
      isClassField: false,
      isStatic: false,
      isParameterDefault: false,
      isAnnotation: false,
    };
  }

  // 8. Class body level declarations (outside method body)
  if (classDepth !== -1 && braceDepth === classDepth + 1) {
    const isAfterArrow = /=>\s*[^;{}]*$/.test(stmtPrefix) || linePrefix.includes("=>");
    if (isAfterArrow && (isWidgetExpr || stmtPrefix.includes("Widget") || stmtPrefix.includes("BuildContext"))) {
      const hasCtx =
        stmtPrefix.includes("BuildContext") ||
        currentClassHeader.includes("State<");
      return {
        isSafeForLocalization: true,
        hasBuildContext: hasCtx,
        isInsideConst: isStmtConst,
        isTopLevel: false,
        isClassField: false,
        isStatic: false,
        isParameterDefault: false,
        isAnnotation: false,
      };
    }

    return {
      isSafeForLocalization: false,
      skipReason: "Class field initializer in Dart has no BuildContext and runs before widget lifecycle",
      hasBuildContext: false,
      isInsideConst: isStmtConst,
      isTopLevel: false,
      isClassField: true,
      isStatic: false,
      isParameterDefault: false,
      isAnnotation: false,
    };
  }

  // 9. Inside method body (braceDepth >= classDepth + 2, or inside function)
  const broadPrefix = sourceCode.slice(Math.max(0, startOffset - 2500), startOffset);
  const hasMethodContext = Boolean(
    broadPrefix.match(
      /(?:Widget\s+build\s*\(\s*BuildContext\s+context\b|\bBuildContext\s+context\b|\bbuild\s*\(\s*BuildContext\s+context\b|\b\(\s*BuildContext\s+context\s*\))/
    )
  );

  const isStateClass = currentClassHeader.includes("State<");
  const isControllerClass = /extends\s+(?:GetxController|ChangeNotifier|Bloc|Cubit|StateNotifier|ViewModel)/.test(
    currentClassHeader
  );

  let hasBuildContext = false;
  if (isStateClass || hasMethodContext) {
    hasBuildContext = true;
  } else if (isControllerClass) {
    hasBuildContext = false;
  } else {
    hasBuildContext = hasMethodContext;
  }

  return {
    isSafeForLocalization: true,
    hasBuildContext,
    isInsideConst: isStmtConst,
    isTopLevel: false,
    isClassField: false,
    isStatic: false,
    isParameterDefault: false,
    isAnnotation: false,
  };
}

export function scanDartSourceFile(options: DartScanOptions): DetectedString[] {
  const {
    filePath,
    sourceCode,
    onlyUserFacing = true,
    minConfidence = 0.0,
    ambiguousOnly = false,
    knownNamespaces,
  } = options;

  if (isNonUiDartFile(filePath) && onlyUserFacing) {
    return [];
  }

  const results: DetectedString[] = [];
  const lineStarts = buildLineStarts(sourceCode);
  const strMatches = findDartStrings(sourceCode);

  const suggestedNs =
    knownNamespaces && knownNamespaces.length > 0
      ? knownNamespaces.find((n) => n.startsWith("intl_") || n.startsWith("app_")) || knownNamespaces[0]!
      : "intl_en";

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

    // 2. Skip logging & debugging calls (logger.d, logger.f, print, debugPrint, log, etc.)
    if (
      /(?:\blogger\.[a-zA-Z0-9_]+|print|log|debugPrint|developer\.log)\s*\(\s*$/.test(linePrefix) ||
      /(?:\blogger\.[a-zA-Z0-9_]+|print|log|debugPrint|developer\.log)\s*\(\s*$/.test(prefixContext)
    ) {
      continue;
    }

    // 3. Skip assertion calls
    if (/\bassert\s*\([^)]*$/.test(linePrefix) || /\bassert\s*\([^)]*$/.test(prefixContext)) {
      continue;
    }

    // 4. Skip internal exceptions (throw Exception(, throw ArgumentError(, etc.)
    if (
      /\bthrow\s+(?:new\s+)?[A-Za-z0-9_]*(?:Exception|Error)\s*\(\s*$/.test(linePrefix) ||
      /\bthrow\s+(?:new\s+)?[A-Za-z0-9_]*(?:Exception|Error)\s*\(\s*$/.test(prefixContext)
    ) {
      continue;
    }

    // 5. Skip Key constructor e.g. Key('home_screen')
    if (/\bKey\s*\(\s*$/.test(linePrefix)) {
      continue;
    }

    // 6. Skip common asset or technical patterns
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

    // 7. Skip strings with no letters (pure symbols, bullets like '•', digits, punctuation)
    if (!/\p{L}/u.test(m.content)) {
      continue;
    }

    // 8. Skip pure variable/punctuation or masking templates (e.g. '\n$var', '$first-XXXX-XXXX-$last')
    if (isOnlyVariablesAndPunctuation(m.content) || isMaskOrPlaceholderPattern(m.content)) {
      continue;
    }

    // Determine surrounding Widget, Prop, or Callee context
    let componentName: string | undefined;
    let propName: string | undefined;
    let calleeName: string | undefined;
    let astType: AstContextType = "STRING_LITERAL";

    const calleeMatch =
      linePrefix.match(/(?:(?:throw\s+)?([a-zA-Z0-9_$.]+))\s*\(\s*$/) ||
      prefixContext.match(/(?:(?:throw\s+)?([a-zA-Z0-9_$.]+))\s*\(\s*$/);
    if (calleeMatch && calleeMatch[1]) {
      calleeName = calleeMatch[1];
    } else if (/\bthrow\s+$/.test(linePrefix.trim())) {
      calleeName = "throw";
    }

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

    // Analyze Dart architectural scope & BuildContext safety
    const scopeAnalysis = analyzeDartScope(
      sourceCode,
      m.startOffset,
      filePath,
      componentName,
      propName
    );

    if (!scopeAnalysis.isSafeForLocalization) {
      if (onlyUserFacing) {
        continue;
      }
      const { line, column } = computeLineAndCol(lineStarts, m.startOffset);
      const endPos = computeLineAndCol(lineStarts, m.endOffset);
      results.push({
        id: `${filePath}:${line}:${column}`,
        file: filePath,
        line,
        column,
        endLine: endPos.line,
        endColumn: endPos.column,
        text: m.content,
        rawText: m.raw,
        type: "STRING_LITERAL",
        classification: "TECHNICAL",
        confidence: 1.0,
        confidenceLevel: "HIGH",
        semanticRole: "CONFIRMED_TECHNICAL",
        reason: scopeAnalysis.skipReason || "Non-UI context (no BuildContext)",
        suggestedNamespace: suggestedNs,
        suggestedKey: generateSemanticKey(m.content, undefined, "lowerCamelCase"),
        hasBuildContext: false,
        isInsideConst: scopeAnalysis.isInsideConst,
      });
      continue;
    }

    // Parse Dart string interpolations
    const interp = parseDartInterpolations(m.content);
    const displayText = interp.templateText;

    if (interp.variables.length > 0) {
      astType = "TEMPLATE_LITERAL";
    }

    const { line, column } = computeLineAndCol(lineStarts, m.startOffset);
    const endPos = computeLineAndCol(lineStarts, m.endOffset);

    // Classify string
    const classificationResult = classifyString({
      text: displayText,
      propName,
      componentName,
      calleeName,
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
      suggestedNamespace: suggestedNs,
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
      hasBuildContext: scopeAnalysis.hasBuildContext,
      isInsideConst: scopeAnalysis.isInsideConst,
    });
  }

  return results;
}
