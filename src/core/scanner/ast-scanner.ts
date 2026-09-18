import ts from "typescript";
import type { AstContextType, DetectedString } from "../../models/scanner.js";
import { classifyString } from "../classifier/classifier.js";
import { generateSemanticKey } from "../keys/key-generator.js";
import { resolveSuggestedNamespace } from "../namespace/namespace-resolver.js";
import type { I18nMcpConfig } from "../../models/config.js";

export interface AstScanOptions {
  filePath: string;
  sourceCode: string;
  knownNamespaces?: string[];
  config?: I18nMcpConfig | null;
  onlyUserFacing?: boolean;
  minConfidence?: number;
}

export function scanSourceFileAst(options: AstScanOptions): DetectedString[] {
  const {
    filePath,
    sourceCode,
    knownNamespaces = ["common"],
    config,
    onlyUserFacing = true,
    minConfidence = 0.0,
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
    } = params;

    handledNodes.add(node);

    const trimmed = text.trim();
    if (!trimmed) return;

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
    });

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

    const suggestedKey = generateSemanticKey(trimmed);
    const suggestedNamespace = resolveSuggestedNamespace(
      filePath,
      trimmed,
      knownNamespaces,
      config
    );

    results.push({
      file: filePath,
      line: line + 1,
      column: character + 1,
      endLine: endPos.line + 1,
      endColumn: endPos.character + 1,
      text: trimmed,
      rawText,
      type: astType,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      confidenceLevel: classificationResult.confidenceLevel,
      suggestedNamespace,
      suggestedKey,
      reason: classificationResult.reason,
      ...(componentName ? { componentName } : {}),
      ...(propName ? { propName } : {}),
      ...(calleeName ? { calleeName } : {}),
      ...(variables && variables.length > 0 ? { variables } : {}),
    });
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

  function visit(node: ts.Node): void {
    // 1. Skip if already inside a translation call like t(...) or i18n.t(...)
    if (isDescendantOfTranslatedCall(node)) {
      return;
    }

    // 2. Skip imports and exports
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
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

  function processTemplateExpression(
    expr: ts.TemplateExpression,
    astType: AstContextType,
    propName?: string,
    compName?: string,
    calleeName?: string
  ): void {
    const variables: string[] = [];
    let formattedText = expr.head.text;

    for (const span of expr.templateSpans) {
      const varName = span.expression.getText(sourceFile).replace(/[^a-zA-Z0-9_]/g, "");
      variables.push(varName || "param");
      formattedText += `{{${varName || "param"}}}` + span.literal.text;
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
    });
  }

  ts.forEachChild(sourceFile, visit);

  return results;
}
