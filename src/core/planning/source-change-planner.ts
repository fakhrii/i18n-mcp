import type { DetectedString } from "../../models/scanner.js";
import type { CodeChange, SourceChangePlan } from "../../models/plan.js";

export interface FileTranslationContext {
  filePath: string;
  hasUseTranslationImport: boolean;
  hasI18nImport: boolean;
  boundNamespaces: string[];
  accessPattern: "useTranslation" | "i18n.t" | "custom" | "none";
}

/**
 * Inspects a source file's text to see if it already has i18n imports or hooks.
 */
export function analyzeFileTranslationContext(
  fileContent: string,
  projectAccessPattern: string = "useTranslation"
): FileTranslationContext {
  const hasUseTranslationImport =
    /import\s+{[^}]*useTranslation[^}]*}\s+from\s+['"]react-i18next['"]/.test(
      fileContent
    );
  const hasI18nImport =
    /import\s+.*i18n.*from\s+['"].*['"]/.test(fileContent);

  const boundNamespaces: string[] = [];

  // Match: useTranslation("auth") or useTranslation(['auth', 'common'])
  const singleNsMatch = fileContent.match(/useTranslation\(\s*["']([^"']+)["']\s*\)/);
  if (singleNsMatch && singleNsMatch[1]) {
    boundNamespaces.push(singleNsMatch[1]);
  }

  const multiNsMatch = fileContent.match(/useTranslation\(\s*\[([^\]]+)\]\s*\)/);
  if (multiNsMatch && multiNsMatch[1]) {
    const rawList = multiNsMatch[1].split(",");
    for (const item of rawList) {
      const cleaned = item.trim().replace(/['"]/g, "");
      if (cleaned && !boundNamespaces.includes(cleaned)) {
        boundNamespaces.push(cleaned);
      }
    }
  }

  let accessPattern: "useTranslation" | "i18n.t" | "custom" | "none" = "none";
  if (projectAccessPattern === "useTranslation" || hasUseTranslationImport || boundNamespaces.length > 0) {
    accessPattern = "useTranslation";
  } else if (projectAccessPattern === "i18n.t" || hasI18nImport) {
    accessPattern = "i18n.t";
  } else if (projectAccessPattern && projectAccessPattern !== "none") {
    accessPattern = "custom";
  }

  return {
    filePath: "",
    hasUseTranslationImport,
    hasI18nImport,
    boundNamespaces,
    accessPattern,
  };
}

/**
 * Builds the replacement expression string based on AST context and detected access patterns.
 */
export function buildReplacementExpression(
  item: DetectedString,
  namespace: string,
  key: string,
  fileContext: FileTranslationContext
): string {
  // Determine if namespace prefix is required:
  // If file is bound to 'auth' and key is in 'common', prefix as 'common:KEY'
  // If file is bound to 'auth' and key is in 'auth', no prefix needed: 'KEY'
  // If no bound namespace in file and using useTranslation, check if namespace needs prefix
  let keyExpression = key;
  const isBoundToNs = fileContext.boundNamespaces.includes(namespace);

  if (fileContext.accessPattern === "i18n.t") {
    keyExpression = `${namespace}:${key}`;
  } else if (!isBoundToNs && fileContext.boundNamespaces.length > 0) {
    keyExpression = `${namespace}:${key}`;
  }

  // Handle template literal variables
  let args = `"${keyExpression}"`;
  if (item.variables && item.variables.length > 0) {
    let varsObj: string;
    if (item.variableExpressions && Object.keys(item.variableExpressions).length > 0) {
      const parts = Object.entries(item.variableExpressions).map(([k, expr]) =>
        k === expr ? k : `${k}: ${expr}`
      );
      varsObj = `{ ${parts.join(", ")} }`;
    } else {
      varsObj = `{ ${item.variables.join(", ")} }`;
    }
    args = `"${keyExpression}", ${varsObj}`;
  }

  // Choose function invocation syntax
  const callExpr =
    fileContext.accessPattern === "i18n.t"
      ? `i18n.t(${args})`
      : `t(${args})`;

  switch (item.type) {
    case "JSX_TEXT":
      return `{${callExpr}}`;

    case "JSX_ATTRIBUTE":
      return `{${callExpr}}`;

    case "CALL_EXPRESSION":
    case "OBJECT_PROPERTY":
    case "ARRAY_ELEMENT":
    case "STRING_LITERAL":
    case "TEMPLATE_LITERAL":
    default:
      return callExpr;
  }
}

/**
 * Computes required code modifications (imports, hooks) for a file if it lacks i18n setup.
 */
export function determineRequiredCodeChanges(
  fileContext: FileTranslationContext,
  targetNamespace: string
): CodeChange[] {
  const changes: CodeChange[] = [];

  if (fileContext.accessPattern === "useTranslation") {
    if (!fileContext.hasUseTranslationImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "useTranslation",
        module: "react-i18next",
      });
    }

    if (fileContext.boundNamespaces.length === 0) {
      changes.push({
        type: "ADD_HOOK",
        value: `const { t } = useTranslation("${targetNamespace}")`,
      });
    }
  } else if (fileContext.accessPattern === "i18n.t") {
    if (!fileContext.hasI18nImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "i18n",
        module: "i18next",
      });
    }
  }

  return changes;
}

/**
 * Plans the source change for a single detected string.
 */
export function planSourceChange(
  item: DetectedString,
  namespace: string,
  key: string,
  fileContext: FileTranslationContext,
  options?: {
    confidenceThreshold?: number;
    includeAmbiguous?: boolean;
  }
): SourceChangePlan {
  const threshold = options?.confidenceThreshold ?? 0.7;

  // Check for ambiguous or low-confidence strings
  if (item.confidence < threshold) {
    return {
      action: "REVIEW",
      file: item.file,
      location: {
        line: item.line,
        column: item.column,
        endLine: item.endLine,
        endColumn: item.endColumn,
      },
      source: item.rawText || item.text,
      replacement: buildReplacementExpression(item, namespace, key, fileContext),
      namespace,
      key,
      confidence: item.confidence,
      reason: "Ambiguous user-facing classification or low confidence",
      status: "SUPPORTED",
    };
  }

  // Check for unsupported situations (e.g. binary concatenation or complex unparsed expressions)
  if (
    ((item.rawText && item.rawText.includes("+")) || item.text.includes("+")) &&
    item.type === "CALL_EXPRESSION" &&
    !item.rawText?.startsWith("`")
  ) {
    return {
      action: "REVIEW",
      file: item.file,
      location: {
        line: item.line,
        column: item.column,
        endLine: item.endLine,
        endColumn: item.endColumn,
      },
      source: item.rawText || item.text,
      replacement: buildReplacementExpression(item, namespace, key, fileContext),
      namespace,
      key,
      confidence: item.confidence,
      status: "UNSUPPORTED",
      reason: "Dynamic string construction cannot be safely transformed",
    };
  }

  const requiredCodeChanges = determineRequiredCodeChanges(fileContext, namespace);

  return {
    action: "REPLACE",
    file: item.file,
    location: {
      line: item.line,
      column: item.column,
      endLine: item.endLine,
      endColumn: item.endColumn,
    },
    source: item.rawText || item.text,
    replacement: buildReplacementExpression(item, namespace, key, fileContext),
    namespace,
    key,
    confidence: item.confidence,
    status: "SUPPORTED",
    requiredCodeChanges: requiredCodeChanges.length > 0 ? requiredCodeChanges : undefined,
  };
}
