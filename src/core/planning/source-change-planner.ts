import type { DetectedString } from "../../models/scanner.js";
import type { CodeChange, SourceChangePlan } from "../../models/plan.js";
import type { I18nStructureType } from "../../models/project.js";

export interface FileTranslationContext {
  filePath: string;
  hasUseTranslationImport: boolean;
  hasTransImport?: boolean;
  hasI18nImport: boolean;
  hasUseTranslationCall?: boolean;
  hasAppLocalizationsImport?: boolean;
  hasL10nAccessor?: boolean;
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
  // Strip comments so commented-out imports don't lead to false positives
  const strippedContent = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const hasUseTranslationImport =
    /import\s+{[^}]*\buseTranslation\b[^}]*}\s+from\s+['"]react-i18next['"]/.test(
      strippedContent
    );
  const hasTransImport =
    /import\s+{[^}]*\bTrans\b[^}]*}\s+from\s+['"]react-i18next['"]/.test(
      strippedContent
    );
  const hasI18nImport =
    /import\s+.*i18n.*from\s+['"].*['"]/.test(strippedContent);

  const hasUseTranslationCall = /useTranslation\s*\(/.test(strippedContent);

  const hasAppLocalizationsImport =
    strippedContent.includes("app_localizations.dart") ||
    strippedContent.includes("AppLocalizations");
  const hasL10nAccessor =
    /\bfinal\s+l10n\s*=/.test(strippedContent) ||
    /\bvar\s+l10n\s*=/.test(strippedContent) ||
    /\bl10n\s*=/.test(strippedContent);

  const boundNamespaces: string[] = [];

  // Match: useTranslation("auth") or useTranslation(['auth', 'common'])
  const singleNsMatch = strippedContent.match(/useTranslation\(\s*["']([^"']+)["']\s*\)/);
  if (singleNsMatch && singleNsMatch[1]) {
    boundNamespaces.push(singleNsMatch[1]);
  }

  const multiNsMatch = strippedContent.match(/useTranslation\(\s*\[([^\]]+)\]\s*\)/);
  if (multiNsMatch && multiNsMatch[1]) {
    const rawList = multiNsMatch[1].split(",");
    for (const item of rawList) {
      const cleaned = item.trim().replace(/['"]/g, "");
      if (cleaned && !boundNamespaces.includes(cleaned)) {
        boundNamespaces.push(cleaned);
      }
    }
  }

  let accessPattern: "useTranslation" | "i18n.t" | "custom" | "none" = "useTranslation";
  if (
    projectAccessPattern === "useTranslation" ||
    projectAccessPattern === "t" ||
    hasUseTranslationImport ||
    boundNamespaces.length > 0
  ) {
    accessPattern = "useTranslation";
  } else if (projectAccessPattern === "i18n.t" || hasI18nImport) {
    accessPattern = "i18n.t";
  } else if (projectAccessPattern && projectAccessPattern !== "none") {
    accessPattern = "useTranslation";
  }

  return {
    filePath: "",
    hasUseTranslationImport,
    hasTransImport,
    hasI18nImport,
    hasUseTranslationCall,
    hasAppLocalizationsImport,
    hasL10nAccessor,
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
  fileContext: FileTranslationContext,
  structureType: I18nStructureType = "namespaces"
): string {
  // Dart Flutter replacement syntax
  if (item.file?.endsWith(".dart") || fileContext.filePath?.endsWith(".dart")) {
    const accessor = fileContext.hasL10nAccessor ? "l10n" : "AppLocalizations.of(context)!";
    if (item.variables && item.variables.length > 0) {
      const vars = item.variables.map((v) => {
        const expr = item.variableExpressions?.[v];
        return expr || v;
      });
      return `${accessor}.${key}(${vars.join(", ")})`;
    }
    return `${accessor}.${key}`;
  }

  let keyExpression = key;

  if (structureType === "nested") {
    // In nested structure, keys are accessed via dot notation: t("auth.login")
    if (namespace && namespace !== "translation" && namespace !== "default") {
      if (key.toLowerCase().startsWith(`${namespace.toLowerCase()}.`)) {
        keyExpression = key;
      } else {
        keyExpression = `${namespace}.${key}`;
      }
    } else {
      keyExpression = key;
    }
  } else if (structureType === "flat") {
    // In flat structure, keys are direct: t("login")
    keyExpression = key;
  } else {
    // In namespaces structure:
    // Determine if namespace prefix is required:
    // In react-i18next, useTranslation(["ns1", "ns2"]) designates the FIRST namespace as default.
    // Any secondary namespace requires prefixing as `${namespace}:${key}`.
    const isPrimaryNs =
      fileContext.boundNamespaces.length > 0 &&
      fileContext.boundNamespaces[0] === namespace;

    if (fileContext.accessPattern === "i18n.t") {
      keyExpression = `${namespace}:${key}`;
    } else if (!isPrimaryNs && fileContext.boundNamespaces.length > 0) {
      keyExpression = `${namespace}:${key}`;
    }
  }

  if (item.isRichText) {
    const compEntries = Object.entries(item.richTextComponents || {});
    let compProp = "";
    if (compEntries.length > 0) {
      const formattedComps = compEntries
        .map(([tag, jsx]) => `${tag}: ${jsx}`)
        .join(", ");
      compProp = ` components={{ ${formattedComps} }}`;
    }

    return `<Trans i18nKey="${keyExpression}"${compProp}>${item.text}</Trans>`;
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
  targetNamespace: string | string[],
  hasRichText = false,
  structureType: I18nStructureType = "namespaces"
): CodeChange[] {
  const changes: CodeChange[] = [];
  if (fileContext.filePath?.endsWith(".dart")) {
    if (!fileContext.hasAppLocalizationsImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "AppLocalizations",
        module: "package:flutter_gen/gen_l10n/app_localizations.dart",
      });
    }
    return changes;
  }

  const targetList = Array.isArray(targetNamespace)
    ? targetNamespace
    : [targetNamespace];

  if (fileContext.accessPattern === "useTranslation" || fileContext.accessPattern === "custom") {
    if (!fileContext.hasUseTranslationImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "useTranslation",
        module: "react-i18next",
      });
    }

    if (structureType === "nested" || structureType === "flat") {
      if (!fileContext.hasUseTranslationCall && fileContext.boundNamespaces.length === 0) {
        changes.push({
          type: "ADD_HOOK",
          value: "const { t } = useTranslation()",
        });
      }
    } else {
      if (fileContext.boundNamespaces.length === 0) {
        const hookVal =
          targetList.length === 1
            ? `const { t } = useTranslation("${targetList[0]}")`
            : `const { t } = useTranslation([${targetList.map((ns) => `"${ns}"`).join(", ")}])`;
        changes.push({
          type: "ADD_HOOK",
          value: hookVal,
        });
      } else {
        const missing = targetList.filter(
          (ns) => !fileContext.boundNamespaces.includes(ns)
        );
        if (missing.length > 0) {
          const merged = [...fileContext.boundNamespaces, ...missing];
          const hookVal = `const { t } = useTranslation([${merged.map((ns) => `"${ns}"`).join(", ")}])`;
          changes.push({
            type: "UPDATE_HOOK",
            value: hookVal,
          });
        }
      }
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

  if (hasRichText && !fileContext.hasTransImport) {
    changes.push({
      type: "ADD_IMPORT",
      value: "Trans",
      module: "react-i18next",
    });
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
    candidateDecisions?: Record<string, boolean>;
    structureType?: I18nStructureType;
  }
): SourceChangePlan {
  const threshold = options?.confidenceThreshold ?? 0.7;
  const structureType = options?.structureType ?? "namespaces";

  // Check if explicit decision was provided by Agent / user
  const candidateId = item.id || `${item.file}:${item.line}:${item.column}`;
  const decision =
    options?.candidateDecisions?.[candidateId] ??
    (item.id ? options?.candidateDecisions?.[item.id] : undefined) ??
    options?.candidateDecisions?.[item.text] ??
    options?.candidateDecisions?.[item.rawText];

  if (decision === false) {
    return {
      action: "SKIP",
      file: item.file,
      location: {
        line: item.line,
        column: item.column,
        endLine: item.endLine,
        endColumn: item.endColumn,
      },
      source: item.rawText || item.text,
      replacement: item.rawText || item.text,
      namespace,
      key,
      confidence: item.confidence,
      reason: "Explicitly skipped by Agent / user decision",
      status: "SUPPORTED",
    };
  }

  const isExplicitlyApproved = decision === true || options?.includeAmbiguous === true;

  // Check for ambiguous or low-confidence strings
  if (item.confidence < threshold && !isExplicitlyApproved) {
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
      replacement: buildReplacementExpression(item, namespace, key, fileContext, structureType),
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
      replacement: buildReplacementExpression(item, namespace, key, fileContext, structureType),
      namespace,
      key,
      confidence: item.confidence,
      status: "UNSUPPORTED",
      reason: "Dynamic string construction cannot be safely transformed",
    };
  }

  const requiredCodeChanges = determineRequiredCodeChanges(
    fileContext,
    namespace,
    item.isRichText,
    structureType
  );

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
    replacement: buildReplacementExpression(item, namespace, key, fileContext, structureType),
    namespace,
    key,
    confidence: item.confidence,
    status: "SUPPORTED",
    requiredCodeChanges: requiredCodeChanges.length > 0 ? requiredCodeChanges : undefined,
  };
}
