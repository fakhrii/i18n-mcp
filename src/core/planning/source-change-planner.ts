import type { DetectedString } from "../../models/scanner.js";
import type { CodeChange, SourceChangePlan } from "../../models/plan.js";
import type { I18nStructureType, FlutterI18nConfig } from "../../models/project.js";

export interface FileTranslationContext {
  filePath: string;
  hasUseTranslationImport: boolean;
  hasTransImport?: boolean;
  hasI18nImport: boolean;
  hasUseTranslationCall?: boolean;
  hasAppLocalizationsImport?: boolean;
  hasFlutterImport?: boolean;
  hasL10nAccessor?: boolean;
  hasTranslateServiceImport?: boolean;
  boundNamespaces: string[];
  accessPattern: "useTranslation" | "i18n.t" | "translate.instant" | "custom" | "none";
  i18nLibrary?: string;
  flutterConfig?: FlutterI18nConfig;
}

/**
 * Inspects a source file's text to see if it already has i18n imports or hooks.
 */
export function analyzeFileTranslationContext(
  fileContent: string,
  projectAccessPattern: string = "useTranslation",
  _i18nLibrary: string = "react-i18next",
  flutterConfig?: FlutterI18nConfig
): FileTranslationContext {
  // Strip comments so commented-out imports don't lead to false positives
  const strippedContent = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  const hasUseTranslationImport =
    /import\s+{[^}]*\b(useTranslation|useTranslations)\b[^}]*}\s+from\s+['"](react-i18next|next-intl|next-i18next)['"]/.test(
      strippedContent
    );
  const hasTransImport =
    /import\s+{[^}]*\bTrans\b[^}]*}\s+from\s+['"]react-i18next['"]/.test(
      strippedContent
    );
  const hasI18nImport =
    /import\s+.*i18n.*from\s+['"].*['"]/.test(strippedContent);

  const hasUseTranslationCall = /(?:useTranslation|useTranslations)\s*\(/.test(
    strippedContent
  );

  const hasAppLocalizationsImport =
    strippedContent.includes("app_localizations.dart") ||
    strippedContent.includes("AppLocalizations");

  const hasFlutterImport =
    hasAppLocalizationsImport ||
    strippedContent.includes("generated/l10n.dart") ||
    (flutterConfig?.className ? strippedContent.includes(flutterConfig.className) : false);

  const hasL10nAccessor =
    /\bfinal\s+l10n\s*=/.test(strippedContent) ||
    /\bvar\s+l10n\s*=/.test(strippedContent) ||
    /\bl10n\s*=/.test(strippedContent);

  const hasTranslateServiceImport =
    strippedContent.includes("TranslateService") ||
    strippedContent.includes("@ngx-translate/core");

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

  let accessPattern: "useTranslation" | "i18n.t" | "translate.instant" | "custom" | "none" = "useTranslation";
  if (
    _i18nLibrary === "@ngx-translate/core" ||
    _i18nLibrary === "ngx-translate" ||
    projectAccessPattern === "translate:pipe" ||
    projectAccessPattern === "translate.instant" ||
    hasTranslateServiceImport
  ) {
    accessPattern = "translate.instant";
  } else if (
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
    hasFlutterImport,
    hasL10nAccessor,
    hasTranslateServiceImport,
    boundNamespaces,
    accessPattern,
    i18nLibrary: _i18nLibrary,
    flutterConfig,
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
    let accessor: string;
    if (fileContext.hasL10nAccessor) {
      accessor = "l10n";
    } else if (item.hasBuildContext === false && fileContext.flutterConfig?.noContextAccessor) {
      accessor = fileContext.flutterConfig.noContextAccessor;
    } else if (fileContext.flutterConfig?.accessor) {
      accessor = fileContext.flutterConfig.accessor;
    } else if (fileContext.i18nLibrary === "flutter_intl") {
      accessor = item.hasBuildContext === false ? "S.current" : "S.of(context)";
    } else {
      accessor = "AppLocalizations.of(context)!";
    }

    if (item.variables && item.variables.length > 0) {
      const vars = item.variables.map((v) => {
        const expr = item.variableExpressions?.[v];
        return expr || v;
      });
      return `${accessor}.${key}(${vars.join(", ")})`;
    }
    return `${accessor}.${key}`;
  }

  // Angular HTML template replacement syntax
  if (item.file?.endsWith(".html") || fileContext.filePath?.endsWith(".html")) {
    let keyExpr = key;
    if (structureType === "nested") {
      if (namespace && namespace !== "translation" && namespace !== "default") {
        if (key.toLowerCase().startsWith(`${namespace.toLowerCase()}.`)) {
          keyExpr = key;
        } else {
          keyExpr = `${namespace}.${key}`;
        }
      } else {
        keyExpr = key;
      }
    } else if (structureType === "flat") {
      keyExpr = key;
    } else {
      if (namespace && namespace !== "common") {
        keyExpr = `${namespace}.${key}`;
      } else {
        keyExpr = key;
      }
    }

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

      if (item.type === "JSX_ATTRIBUTE") {
        return `"{{ '${keyExpr}' | translate: ${varsObj} }}"`;
      }
      return `{{ '${keyExpr}' | translate: ${varsObj} }}`;
    }

    if (item.type === "JSX_ATTRIBUTE") {
      return `"{{ '${keyExpr}' | translate }}"`;
    }
    return `{{ '${keyExpr}' | translate }}`;
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
    fileContext.accessPattern === "translate.instant"
      ? `this.translate.instant(${args})`
      : fileContext.accessPattern === "i18n.t"
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
  if (fileContext.filePath?.endsWith(".html")) {
    return changes;
  }

  if (fileContext.filePath?.endsWith(".dart")) {
    if (!fileContext.hasFlutterImport && !fileContext.hasAppLocalizationsImport) {
      const module =
        fileContext.flutterConfig?.importStatement.match(/import\s+['"]([^'"]+)['"]/)?.[1] ||
        (fileContext.i18nLibrary === "flutter_intl"
          ? "generated/l10n.dart"
          : "package:flutter_gen/gen_l10n/app_localizations.dart");
      const value =
        fileContext.flutterConfig?.className ||
        (fileContext.i18nLibrary === "flutter_intl" ? "S" : "AppLocalizations");
      changes.push({
        type: "ADD_IMPORT",
        value,
        module,
      });
    }
    return changes;
  }

  if (
    fileContext.i18nLibrary === "@ngx-translate/core" ||
    fileContext.i18nLibrary === "ngx-translate" ||
    fileContext.accessPattern === "translate.instant"
  ) {
    if (!fileContext.hasTranslateServiceImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "TranslateService",
        module: "@ngx-translate/core",
      });
    }
    return changes;
  }

  const targetList = Array.isArray(targetNamespace)
    ? targetNamespace
    : [targetNamespace];

  if (fileContext.i18nLibrary === "next-intl") {
    if (!fileContext.hasUseTranslationImport) {
      changes.push({
        type: "ADD_IMPORT",
        value: "useTranslations",
        module: "next-intl",
      });
    }

    if (!fileContext.hasUseTranslationCall && fileContext.boundNamespaces.length === 0) {
      const hookVal =
        targetList.length === 1 && targetList[0] !== "common"
          ? `const t = useTranslations("${targetList[0]}")`
          : `const t = useTranslations()`;
      changes.push({
        type: "ADD_HOOK",
        value: hookVal,
      });
    }
    return changes;
  }

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
