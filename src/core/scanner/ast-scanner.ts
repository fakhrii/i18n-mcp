import ts from "typescript";
import type { AstContextType, DetectedString } from "../../models/scanner.js";
import { classifyString, computeSemanticRole } from "../classifier/classifier.js";
import { generateSemanticKey } from "../keys/key-generator.js";
import { resolveSuggestedNamespace } from "../namespace/namespace-resolver.js";
import { isCountIdentifier, derivePluralForms } from "../plural/plural-helper.js";
import { extractRichTextJsx } from "./rich-text-helper.js";
import type { I18nMcpConfig } from "../../models/config.js";

export interface AstScanOptions {
  filePath: string;
  sourceCode: string;
  knownNamespaces?: string[];
  config?: I18nMcpConfig | null;
  onlyUserFacing?: boolean;
  minConfidence?: number;
  ambiguousOnly?: boolean;
}

export function scanSourceFileAst(options: AstScanOptions): DetectedString[] {
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
  const handledNodes = new Set<ts.Node>();

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  function addCandidate(params: {
    node: ts.Node;
    text: string;
    rawText: string;
    astType: AstContextType;
    propName?: string;
    componentName?: string;
    calleeName?: string;
    isComparison?: boolean;
    isSwitchCase?: boolean;
    variables?: string[];
    variableExpressions?: Record<string, string>;
    isPlural?: boolean;
    pluralVariable?: string;
    pluralForm?: { one: string; other: string };
    isRichText?: boolean;
    richTextComponents?: Record<string, string>;
  }): void {
    const {
      node,
      text,
      rawText,
      astType,
      propName,
      componentName,
      calleeName,
      isComparison,
      isSwitchCase,
      variables,
      variableExpressions,
      isPlural,
      pluralVariable,
      pluralForm,
      isRichText,
      richTextComponents,
    } = params;

    handledNodes.add(node);

    const trimmed = text.trim();
    if (!trimmed) return;

    const enclosingVar = getEnclosingVariableName(node);

    // Classify
    const classificationResult = classifyString({
      text: trimmed,
      astType,
      propName,
      componentName,
      calleeName,
      isComparison,
      isSwitchCase,
      isStyleContext: isInsideStyleContext(node),
      variableName: enclosingVar,
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

    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile)
    );
    const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    const suggestedKey = generateSemanticKey(trimmed, propName || componentName);
    const suggestedNamespace = resolveSuggestedNamespace(
      filePath,
      trimmed,
      knownNamespaces,
      config
    );

    const startLine = line + 1;
    const startCol = character + 1;
    const candidateId = `${filePath}:${startLine}:${startCol}`;

    results.push({
      id: candidateId,
      file: filePath,
      line: startLine,
      column: startCol,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
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
      ...(calleeName ? { calleeName } : {}),
      ...(variables && variables.length > 0 ? { variables } : {}),
      ...(variableExpressions && Object.keys(variableExpressions).length > 0
        ? { variableExpressions }
        : {}),
      ...(isPlural ? { isPlural, pluralVariable, pluralForm } : {}),
      ...(isRichText ? { isRichText, richTextComponents } : {}),
    });
  }

  function getEnclosingVariableName(node: ts.Node): string | undefined {
    let curr: ts.Node | undefined = node.parent;
    while (curr && curr !== sourceFile) {
      if (ts.isVariableDeclaration(curr) && ts.isIdentifier(curr.name)) {
        return curr.name.text;
      }
      if (ts.isPropertyDeclaration(curr) && ts.isIdentifier(curr.name)) {
        return curr.name.text;
      }
      curr = curr.parent;
    }
    return undefined;
  }

  function getEnclosingComponentName(node: ts.Node): string | undefined {
    let curr = node.parent;
    while (curr) {
      if (ts.isJsxOpeningElement(curr) || ts.isJsxSelfClosingElement(curr)) {
        return curr.tagName.getText(sourceFile);
      }
      if (ts.isJsxElement(curr)) {
        return curr.openingElement.tagName.getText(sourceFile);
      }
      curr = curr.parent;
    }
    return undefined;
  }

  function getEnclosingCalleeName(node: ts.Node): string | undefined {
    let curr = node.parent;
    while (curr) {
      if (ts.isCallExpression(curr)) {
        return curr.expression.getText(sourceFile);
      }
      curr = curr.parent;
    }
    return undefined;
  }

  function isDescendantOfTranslatedCall(node: ts.Node): boolean {
    let curr = node.parent;
    while (curr) {
      if (ts.isCallExpression(curr)) {
        const exprText = curr.expression.getText(sourceFile);
        if (
          exprText === "t" ||
          exprText === "i18n.t" ||
          exprText === "translate" ||
          exprText.endsWith(".t")
        ) {
          return true;
        }
      }
      curr = curr.parent;
    }
    return false;
  }

  function isInsideStyleContext(node: ts.Node): boolean {
    let curr = node.parent;
    while (curr) {
      // 1. Tagged template expressions like styled.View`...` or css`...`
      if (ts.isTaggedTemplateExpression(curr)) {
        const tagText = curr.tag.getText(sourceFile);
        if (
          tagText.startsWith("styled") ||
          tagText === "css" ||
          tagText.endsWith(".css")
        ) {
          return true;
        }
      }

      // 2. Inside StyleSheet.create(...) or makeStyles / createStyles / etc.
      if (ts.isCallExpression(curr)) {
        const callText = curr.expression.getText(sourceFile);
        if (
          callText === "StyleSheet.create" ||
          callText.endsWith(".create") ||
          callText === "StyleSheet.compose" ||
          callText === "StyleSheet.flatten" ||
          callText === "createStyles" ||
          callText === "makeStyles" ||
          callText === "useStyles"
        ) {
          return true;
        }
      }

      // 3. Inside a JSX style attribute: style={...}, contentContainerStyle={...}, *Style={...}
      if (ts.isJsxAttribute(curr)) {
        const attrName = curr.name.getText(sourceFile).toLowerCase();
        if (
          attrName === "style" ||
          attrName.endsWith("style") ||
          attrName.endsWith("styles")
        ) {
          return true;
        }
      }

      // 4. Inside a variable declaration whose name ends with Style or Styles (or is 'styles' / 'style')
      if (ts.isVariableDeclaration(curr) && ts.isIdentifier(curr.name)) {
        const varName = curr.name.text.toLowerCase();
        if (
          (varName === "style" ||
            varName === "styles" ||
            varName.endsWith("style") ||
            varName.endsWith("styles")) &&
          curr.initializer &&
          (ts.isObjectLiteralExpression(curr.initializer) ||
            ts.isCallExpression(curr.initializer) ||
            ts.isArrowFunction(curr.initializer) ||
            ts.isFunctionExpression(curr.initializer))
        ) {
          return true;
        }
      }

      curr = curr.parent;
    }
    return false;
  }

  function isDialogOrToastCall(callee: string): boolean {
    const c = callee.toLowerCase();
    return (
      c === "alert.alert" ||
      c === "alert" ||
      c.endsWith(".alert") ||
      c.includes("toast") ||
      c.includes("notify") ||
      c.includes("snackbar") ||
      c.includes("dialog") ||
      c === "seterror" ||
      c === "setfielderror"
    );
  }

  function handleConditionalPlural(
    condExpr: ts.ConditionalExpression,
    compName?: string,
    astType: AstContextType = "JSX_TEXT"
  ): boolean {
    if (!ts.isBinaryExpression(condExpr.condition)) return false;
    const op = condExpr.condition.operatorToken.kind;
    const isEq =
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken;

    if (!isEq) return false;

    const left = condExpr.condition.left;
    const right = condExpr.condition.right;

    let countVarExpr: ts.Expression | undefined;
    if (ts.isNumericLiteral(right) && right.text === "1") {
      countVarExpr = left;
    } else if (ts.isNumericLiteral(left) && left.text === "1") {
      countVarExpr = right;
    }

    if (!countVarExpr) return false;

    const countExpressionText = countVarExpr.getText(sourceFile).trim();

    // Extract singular text from whenTrue
    let singularText = "";
    if (ts.isStringLiteral(condExpr.whenTrue)) {
      singularText = condExpr.whenTrue.text;
    } else if (ts.isNoSubstitutionTemplateLiteral(condExpr.whenTrue)) {
      singularText = condExpr.whenTrue.text;
    }

    // Extract plural text from whenFalse
    let pluralText = "";
    if (ts.isTemplateExpression(condExpr.whenFalse)) {
      let formatted = condExpr.whenFalse.head.text;
      for (const span of condExpr.whenFalse.templateSpans) {
        formatted += "{{count}}" + span.literal.text;
      }
      pluralText = formatted;
    } else if (
      ts.isStringLiteral(condExpr.whenFalse) ||
      ts.isNoSubstitutionTemplateLiteral(condExpr.whenFalse)
    ) {
      pluralText = condExpr.whenFalse.text;
    }

    if (!singularText || !pluralText) return false;

    handledNodes.add(condExpr);
    handledNodes.add(condExpr.condition);
    handledNodes.add(condExpr.whenTrue);
    handledNodes.add(condExpr.whenFalse);

    addCandidate({
      node: condExpr,
      text: pluralText,
      rawText: condExpr.getText(sourceFile),
      astType,
      componentName: compName,
      variables: ["count"],
      variableExpressions: { count: countExpressionText },
      isPlural: true,
      pluralVariable: "count",
      pluralForm: {
        one: singularText,
        other: pluralText,
      },
    });

    return true;
  }

  function visit(node: ts.Node): void {
    // 1. Skip if already inside a translation call like t(...) or i18n.t(...)
    if (isDescendantOfTranslatedCall(node)) {
      return;
    }

    // 2. Skip imports and exports
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
    }

    // 2b. Detect compound rich text JSX elements: <Text>Please read <Text style={styles.link}>Terms</Text></Text>
    if (ts.isJsxElement(node) && !handledNodes.has(node)) {
      const rich = extractRichTextJsx(node, sourceFile);
      if (rich) {
        handledNodes.add(node);
        handledNodes.add(node.openingElement);
        handledNodes.add(node.closingElement);
        for (const child of rich.handledChildNodes) {
          handledNodes.add(child);
        }

        const compName = node.openingElement.tagName.getText(sourceFile);
        addCandidate({
          node,
          text: rich.compositeText,
          rawText: rich.rawText,
          astType: "JSX_TEXT",
          componentName: compName,
          isRichText: true,
          richTextComponents: rich.components,
        });
        return;
      }
    }

    // 3. Detect JSX Text: <Text>Welcome back</Text>
    if (ts.isJsxText(node)) {
      const rawText = node.getText(sourceFile);
      const trimmed = rawText.trim();
      if (trimmed) {
        const compName = getEnclosingComponentName(node);
        addCandidate({
          node,
          text: trimmed,
          rawText,
          astType: "JSX_TEXT",
          componentName: compName,
        });
      }
      return;
    }

    // 3b. Detect JSX Expression children: <Text>{`Hello ${name}`}</Text> or <Text>{"Hello"}</Text>
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const compName = getEnclosingComponentName(node);
      const expr = node.expression;
      if (ts.isStringLiteral(expr)) {
        addCandidate({
          node: expr,
          text: expr.text,
          rawText: expr.getText(sourceFile),
          astType: "JSX_TEXT",
          componentName: compName,
        });
        return;
      } else if (ts.isTemplateExpression(expr)) {
        processTemplateExpression(expr, "TEMPLATE_LITERAL", undefined, compName);
        return;
      } else if (ts.isNoSubstitutionTemplateLiteral(expr)) {
        addCandidate({
          node: expr,
          text: expr.text,
          rawText: expr.getText(sourceFile),
          astType: "TEMPLATE_LITERAL",
          componentName: compName,
        });
        return;
      } else if (ts.isConditionalExpression(expr)) {
        if (handleConditionalPlural(expr, compName, "JSX_TEXT")) {
          return;
        }
      }
    }

    // 4. Detect JSX Attributes: <Button title="Continue" /> or <TextInput placeholder="Email" />
    if (ts.isJsxAttribute(node)) {
      const propName = node.name.getText(sourceFile);
      const compName = getEnclosingComponentName(node);

      if (node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          addCandidate({
            node: node.initializer,
            text: node.initializer.text,
            rawText: node.initializer.getText(sourceFile),
            astType: "JSX_ATTRIBUTE",
            propName,
            componentName: compName,
          });
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const expr = node.initializer.expression;
          if (ts.isStringLiteral(expr)) {
            addCandidate({
              node: expr,
              text: expr.text,
              rawText: expr.getText(sourceFile),
              astType: "JSX_ATTRIBUTE",
              propName,
              componentName: compName,
            });
          } else if (ts.isTemplateExpression(expr)) {
            processTemplateExpression(expr, "JSX_ATTRIBUTE", propName, compName);
          } else if (ts.isNoSubstitutionTemplateLiteral(expr)) {
            addCandidate({
              node: expr,
              text: expr.text,
              rawText: expr.getText(sourceFile),
              astType: "TEMPLATE_LITERAL",
              propName,
              componentName: compName,
            });
          }
        }
      }
      // Continue visiting children
      ts.forEachChild(node, visit);
      return;
    }

    // 5. Detect Call Expression arguments: Alert.alert("Error", "Message"), showToast("Updated")
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);

      // Skip translation calls
      if (
        callee === "t" ||
        callee === "i18n.t" ||
        callee === "translate" ||
        callee.endsWith(".t") ||
        callee === "useTranslation" ||
        callee === "require"
      ) {
        return;
      }

      const isDialog = isDialogOrToastCall(callee);
      node.arguments.forEach((arg, index) => {
        const propName = isDialog ? (index === 0 ? "title" : "message") : undefined;
        if (ts.isStringLiteral(arg)) {
          addCandidate({
            node: arg,
            text: arg.text,
            rawText: arg.getText(sourceFile),
            astType: "CALL_EXPRESSION",
            calleeName: callee,
            propName,
          });
        } else if (ts.isNoSubstitutionTemplateLiteral(arg)) {
          addCandidate({
            node: arg,
            text: arg.text,
            rawText: arg.getText(sourceFile),
            astType: "TEMPLATE_LITERAL",
            calleeName: callee,
            propName,
          });
        } else if (ts.isTemplateExpression(arg)) {
          processTemplateExpression(arg, "TEMPLATE_LITERAL", propName, undefined, callee);
        }
      });

      ts.forEachChild(node, visit);
      return;
    }

    // 6. Detect Object Properties: { label: "Daily", description: "Every day" }
    if (ts.isPropertyAssignment(node)) {
      const propName = node.name.getText(sourceFile);
      const enclosingCallee = getEnclosingCalleeName(node);

      if (ts.isStringLiteral(node.initializer)) {
        addCandidate({
          node: node.initializer,
          text: node.initializer.text,
          rawText: node.initializer.getText(sourceFile),
          astType: "OBJECT_PROPERTY",
          propName,
          calleeName: enclosingCallee,
        });
      } else if (ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
        addCandidate({
          node: node.initializer,
          text: node.initializer.text,
          rawText: node.initializer.getText(sourceFile),
          astType: "TEMPLATE_LITERAL",
          propName,
          calleeName: enclosingCallee,
        });
      } else if (ts.isTemplateExpression(node.initializer)) {
        processTemplateExpression(
          node.initializer,
          "TEMPLATE_LITERAL",
          propName,
          undefined,
          enclosingCallee
        );
      }

      ts.forEachChild(node, visit);
      return;
    }

    // 7. Detect Comparison or Switch expressions
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const isEq =
        op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken;

      if (isEq) {
        if (ts.isStringLiteral(node.left)) {
          addCandidate({
            node: node.left,
            text: node.left.text,
            rawText: node.left.getText(sourceFile),
            astType: "STRING_LITERAL",
            isComparison: true,
          });
        }
        if (ts.isStringLiteral(node.right)) {
          addCandidate({
            node: node.right,
            text: node.right.text,
            rawText: node.right.getText(sourceFile),
            astType: "STRING_LITERAL",
            isComparison: true,
          });
        }
      }
    }

    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
      addCandidate({
        node: node.expression,
        text: node.expression.text,
        rawText: node.expression.getText(sourceFile),
        astType: "STRING_LITERAL",
        isSwitchCase: true,
      });
    }

    if (ts.isConditionalExpression(node) && !handledNodes.has(node)) {
      if (handleConditionalPlural(node, getEnclosingComponentName(node), "STRING_LITERAL")) {
        return;
      }
    }

    // 8. General string literals not handled in specific expressions
    if (ts.isStringLiteral(node) && !handledNodes.has(node)) {
      let propName: string | undefined;
      let astType: AstContextType = "STRING_LITERAL";

      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        propName = node.parent.name.text;
      } else if (ts.isArrayLiteralExpression(node.parent)) {
        astType = "ARRAY_ELEMENT";
      }

      addCandidate({
        node,
        text: node.text,
        rawText: node.getText(sourceFile),
        astType,
        propName,
      });
      return;
    }

    if (ts.isNoSubstitutionTemplateLiteral(node) && !handledNodes.has(node)) {
      let propName: string | undefined;
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        propName = node.parent.name.text;
      }
      addCandidate({
        node,
        text: node.text,
        rawText: node.getText(sourceFile),
        astType: "TEMPLATE_LITERAL",
        propName,
      });
      return;
    }

    if (ts.isTemplateExpression(node) && !handledNodes.has(node)) {
      let propName: string | undefined;
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        propName = node.parent.name.text;
      }
      processTemplateExpression(node, "TEMPLATE_LITERAL", propName);
      return;
    }

    ts.forEachChild(node, visit);
  }

  const COMMON_BUILTIN_NAMES = new Set([
    "string", "number", "boolean", "math", "json", "object", "array", "date",
    "parseint", "parsefloat", "padstart", "padend", "tostring", "tofixed",
    "slice", "substring", "trim", "tolowercase", "touppercase", "format",
    "concat", "join", "map", "filter", "reduce", "length", "split", "replace"
  ]);

  function findMeaningfulIdentifier(node: ts.Node): string | undefined {
    let candidate: string | undefined;

    function walk(n: ts.Node) {
      if (candidate) return;
      if (ts.isIdentifier(n)) {
        const text = n.text;
        if (!COMMON_BUILTIN_NAMES.has(text.toLowerCase())) {
          candidate = text;
          return;
        }
      }
      ts.forEachChild(n, walk);
    }

    walk(node);
    return candidate;
  }

  function sanitizeVarName(name: string): string {
    const clean = name.replace(/[^a-zA-Z0-9_]/g, "");
    if (!clean) return "param";
    if (!/^[a-zA-Z_$]/.test(clean)) {
      return `val_${clean}`;
    }
    return clean;
  }

  function extractTemplateVariable(
    expr: ts.Expression,
    existingVarNames: Set<string>
  ): { varName: string; expressionText: string } {
    const expressionText = expr.getText(sourceFile).trim();

    // 1. Simple identifier: e.g. minutes, count, userName
    if (ts.isIdentifier(expr)) {
      let varName = sanitizeVarName(expr.text);
      if (existingVarNames.has(varName)) {
        varName = `${varName}_val`;
      }
      return { varName, expressionText };
    }

    // 2. Property access: e.g. user.firstName, props.title, items.length
    if (ts.isPropertyAccessExpression(expr)) {
      const prop = expr.name.text;
      if (isCountIdentifier(prop, expressionText)) {
        return { varName: "count", expressionText };
      }
      let varName = sanitizeVarName(prop);
      if (existingVarNames.has(varName) && ts.isIdentifier(expr.expression)) {
        varName = `${expr.expression.text}_${prop}`;
      }
      if (existingVarNames.has(varName)) {
        varName = `${varName}_val`;
      }
      return { varName, expressionText };
    }

    // 3. Meaningful identifier inside complex call/expression:
    // e.g. String(seconds).padStart(2, '0') -> 'seconds'
    const meaningfulId = findMeaningfulIdentifier(expr);
    if (meaningfulId) {
      let varName = sanitizeVarName(meaningfulId);
      if (existingVarNames.has(varName)) {
        varName = `${varName}_val`;
      }
      return { varName, expressionText };
    }

    // 4. Fallback: sanitize expression text or use 'param'
    let varName = sanitizeVarName(expressionText);
    if (existingVarNames.has(varName)) {
      varName = `${varName}_val`;
    }
    return { varName, expressionText };
  }

  function processTemplateExpression(
    expr: ts.TemplateExpression,
    astType: AstContextType,
    propName?: string,
    compName?: string,
    calleeName?: string
  ): void {
    const variables: string[] = [];
    const variableExpressions: Record<string, string> = {};
    const usedVarNames = new Set<string>();
    let formattedText = expr.head.text;

    for (const span of expr.templateSpans) {
      const { varName, expressionText } = extractTemplateVariable(
        span.expression,
        usedVarNames
      );
      usedVarNames.add(varName);
      variables.push(varName);
      variableExpressions[varName] = expressionText;
      formattedText += `{{${varName}}}` + span.literal.text;
    }

    let isPlural = false;
    let pluralVariable: string | undefined;
    let pluralForm: { one: string; other: string } | undefined;

    if (variables.includes("count")) {
      const forms = derivePluralForms(formattedText, "count");
      if (forms.one !== forms.other) {
        isPlural = true;
        pluralVariable = "count";
        pluralForm = forms;
      }
    }

    addCandidate({
      node: expr,
      text: formattedText,
      rawText: expr.getText(sourceFile),
      astType,
      propName,
      componentName: compName,
      calleeName,
      variables,
      variableExpressions,
      isPlural,
      pluralVariable,
      pluralForm,
    });
  }

  ts.forEachChild(sourceFile, visit);

  return results;
}
