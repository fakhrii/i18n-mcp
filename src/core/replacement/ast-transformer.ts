import ts from "typescript";
import type { CodeChange, SourceChangePlan } from "../../models/plan.js";
import type { ApplyError, ApplyWarning } from "../../models/replacement.js";
import { toPosixPath } from "../../utils/file-system.js";

export interface SourceTransformResult {
  transformedContent: string;
  changesApplied: number;
  warnings: ApplyWarning[];
  errors: ApplyError[];
}

/**
 * Checks if a string literal or raw text matches expected source text, ignoring insignificant edge whitespace.
 */
function isSourceMatching(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  if (actual.trim() === expected.trim()) return true;
  // If expected has surrounding quotes and actual doesn't, or vice-versa
  const stripQuotes = (s: string) => s.trim().replace(/^["'`]|["'`]$/g, "");
  return stripQuotes(actual) === stripQuotes(expected);
}

/**
 * Injects required imports into the source code if not already present.
 * Uses TypeScript AST for reliable positioning, handling multi-line imports,
 * directives ("use client", "use strict"), and comments.
 */
export function injectRequiredImports(
  sourceText: string,
  codeChanges: CodeChange[]
): string {
  let result = sourceText;

  const importChanges = codeChanges.filter(
    (c) => c.type === "ADD_IMPORT" && (c.module === "react-i18next" || c.module === "i18next")
  );
  if (importChanges.length === 0) {
    return result;
  }

  for (const change of importChanges) {
    const moduleName = change.module || "react-i18next";
    const importItem = change.value; // e.g. "useTranslation", "Trans", "i18n"

    const sourceFile = ts.createSourceFile(
      "temp.tsx",
      result,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX
    );

    const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);

    // 1. Check if module is already imported
    const existingDecl = importDeclarations.find(
      (decl) =>
        ts.isStringLiteral(decl.moduleSpecifier) &&
        decl.moduleSpecifier.text === moduleName
    );

    if (existingDecl) {
      const importClause = existingDecl.importClause;
      if (!importClause) {
        // e.g. import "react-i18next";
        const start = existingDecl.getStart(sourceFile);
        const end = existingDecl.getEnd();
        result =
          result.slice(0, start) +
          `import { ${importItem} } from "${moduleName}";` +
          result.slice(end);
        continue;
      }

      // Check default import: e.g. import i18n from "i18next"
      if (importClause.name && importClause.name.text === importItem) {
        continue; // Already imported
      }

      // Check named imports: e.g. import { useTranslation } from "react-i18next"
      if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
        const hasItem = importClause.namedBindings.elements.some(
          (elem) => (elem.propertyName?.text || elem.name.text) === importItem
        );
        if (hasItem) {
          continue; // Already imported
        }

        // Replace named bindings with updated list
        const existingNames = importClause.namedBindings.elements.map((elem) =>
          elem.propertyName
            ? `${elem.propertyName.text} as ${elem.name.text}`
            : elem.name.text
        );
        const updatedList = [...existingNames, importItem].join(", ");
        const replacement = `{ ${updatedList} }`;

        result =
          result.slice(0, importClause.namedBindings.getStart(sourceFile)) +
          replacement +
          result.slice(importClause.namedBindings.getEnd());
        continue;
      } else if (importClause.name && !importClause.namedBindings) {
        // Has default import, e.g. import React from "react-i18next"
        // Convert to: import React, { useTranslation } from "react-i18next"
        const defaultNameEnd = importClause.name.getEnd();
        result =
          result.slice(0, defaultNameEnd) +
          `, { ${importItem} }` +
          result.slice(defaultNameEnd);
        continue;
      }
    } else {
      // 2. No import from moduleName exists yet: insert a new import declaration
      let insertPos = 0;
      let leadingNewline = "";
      let trailingNewline = "\n";

      if (importDeclarations.length > 0) {
        // Find the absolute highest end offset among all import declarations
        const lastImport = importDeclarations[importDeclarations.length - 1]!;
        insertPos = lastImport.getEnd();
        leadingNewline = "\n";
        trailingNewline = "";
      } else {
        // Check for directives at file start (e.g. 'use client', 'use strict')
        const directives = sourceFile.statements.filter(
          (s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)
        );
        if (directives.length > 0) {
          const lastDirective = directives[directives.length - 1]!;
          insertPos = lastDirective.getEnd();
          leadingNewline = "\n\n";
          trailingNewline = "";
        }
      }

      const newImportStatement =
        importItem === "i18n" && moduleName === "i18next"
          ? `${leadingNewline}import i18n from "${moduleName}";${trailingNewline}`
          : `${leadingNewline}import { ${importItem} } from "${moduleName}";${trailingNewline}`;

      result =
        result.slice(0, insertPos) +
        newImportStatement +
        result.slice(insertPos);
    }
  }

  return result;
}

/**
 * Recursively unwraps HOC calls (React.memo, forwardRef, etc.), parens, and type assertions
 * to retrieve the underlying component function declaration or arrow function.
 */
function unwrapComponentFunction(
  expr: ts.Expression
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return expr;
  }
  if (ts.isCallExpression(expr) && expr.arguments.length > 0) {
    return unwrapComponentFunction(expr.arguments[0]!);
  }
  if (ts.isParenthesizedExpression(expr)) {
    return unwrapComponentFunction(expr.expression);
  }
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    return unwrapComponentFunction(expr.expression);
  }
  return undefined;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

function functionCallsT(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const exprText = n.expression.getText();
      if (exprText === "t") {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

function findUseTranslationCall(node: ts.Node): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      if (callee === "useTranslation" || callee.endsWith(".useTranslation")) {
        found = n;
        return;
      }
    }
    // Don't recurse into nested function components
    if (
      n !== node &&
      (ts.isFunctionDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n))
    ) {
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

function functionDeclaresT(fn: ts.FunctionLikeDeclaration): boolean {
  // 1. Check parameters
  for (const param of fn.parameters) {
    if (ts.isIdentifier(param.name) && param.name.text === "t") {
      return true;
    }
    if (ts.isObjectBindingPattern(param.name)) {
      if (
        param.name.elements.some(
          (e) => ts.isIdentifier(e.name) && e.name.text === "t"
        )
      ) {
        return true;
      }
    }
  }

  // 2. Check variable declarations in body
  if (fn.body && ts.isBlock(fn.body)) {
    for (const stmt of fn.body.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === "t") {
            return true;
          }
          if (ts.isObjectBindingPattern(decl.name)) {
            if (
              decl.name.elements.some(
                (e) => ts.isIdentifier(e.name) && e.name.text === "t"
              )
            ) {
              return true;
            }
          }
        }
      }
    }
  }

  return false;
}

function detectIndentation(body: ts.Block, sourceFile: ts.SourceFile): string {
  if (body.statements.length > 0) {
    const firstStmt = body.statements[0]!;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      firstStmt.getStart(sourceFile)
    );
    const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
    const linePrefix = sourceFile.text.slice(lineStart, lineStart + character);
    const indentMatch = linePrefix.match(/^(\s+)/);
    if (indentMatch) {
      return indentMatch[1]!;
    }
  }
  return "  ";
}

interface ComponentTarget {
  name?: string;
  funcNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
  body: ts.Block | ts.Expression;
  isConciseArrow: boolean;
  hasHookCall: boolean;
  hookCallNode?: ts.CallExpression;
  declaresT: boolean;
  callsT: boolean;
}

function findComponentTargets(sourceFile: ts.SourceFile): ComponentTarget[] {
  const targets: ComponentTarget[] = [];

  function checkAndAdd(
    name: string | undefined,
    func: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
    isExportDefault: boolean
  ) {
    if (!func.body) return;

    const isNamedComponent = !!name && /^[A-Z]/.test(name);
    const hasJsx = containsJsx(func.body);
    const callsT = functionCallsT(func.body);

    if (isNamedComponent || isExportDefault || hasJsx || callsT) {
      const hookCall = findUseTranslationCall(func.body);
      const declaresT = functionDeclaresT(func);

      targets.push({
        name,
        funcNode: func,
        body: func.body,
        isConciseArrow: !ts.isBlock(func.body),
        hasHookCall: !!hookCall,
        hookCallNode: hookCall,
        declaresT,
        callsT,
      });
    }
  }

  for (const stmt of sourceFile.statements) {
    // 1. Function declaration
    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const name = stmt.name ? stmt.name.text : undefined;
      const isDefault =
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      checkAndAdd(name, stmt, isDefault);
    }
    // 2. Variable statement
    else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (decl.initializer) {
          const unwrapped = unwrapComponentFunction(decl.initializer);
          if (unwrapped) {
            const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined;
            checkAndAdd(name, unwrapped, false);
          }
        }
      }
    }
    // 3. Export assignment (export default ...)
    else if (ts.isExportAssignment(stmt)) {
      const unwrapped = unwrapComponentFunction(stmt.expression);
      if (unwrapped) {
        checkAndAdd(undefined, unwrapped, true);
      }
    }
  }

  return targets;
}

/**
 * Injects required hook declarations (e.g. `const { t } = useTranslation("auth");`)
 * into the top of the enclosing React functional component body.
 * Robustly handles multi-component files, HOCs (memo, forwardRef), anonymous exports,
 * and concise arrow expression bodies.
 */
export function injectRequiredHooks(
  sourceText: string,
  filePath: string,
  codeChanges: CodeChange[]
): { updatedText: string; warnings: ApplyWarning[]; errors: ApplyError[] } {
  const warnings: ApplyWarning[] = [];
  const errors: ApplyError[] = [];
  let updatedText = sourceText;

  const hookChanges = codeChanges.filter(
    (c) => c.type === "ADD_HOOK" || c.type === "UPDATE_HOOK"
  );
  if (hookChanges.length === 0) {
    return { updatedText, warnings, errors };
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    updatedText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const targets = findComponentTargets(sourceFile);
  if (targets.length === 0) {
    warnings.push({
      code: "HOOK_INJECTION_SKIPPED",
      message: `Could not safely locate top-level React component body to inject hook in "${toPosixPath(filePath)}"`,
      file: toPosixPath(filePath),
    });
    return { updatedText, warnings, errors };
  }

  interface TextEdit {
    start: number;
    end: number;
    replacement: string;
  }
  const edits: TextEdit[] = [];

  const updateHookChange = hookChanges.find((c) => c.type === "UPDATE_HOOK");
  const addHookChange = hookChanges.find((c) => c.type === "ADD_HOOK");
  const defaultHookValue =
    addHookChange?.value ??
    updateHookChange?.value ??
    'const { t } = useTranslation("common")';

  // 1. Process targets
  for (const target of targets) {
    // If target already has useTranslation
    if (target.hasHookCall && target.hookCallNode) {
      if (updateHookChange) {
        const newCallMatch = updateHookChange.value.match(/useTranslation\s*\([^)]*\)/);
        if (newCallMatch) {
          const start = target.hookCallNode.getStart(sourceFile);
          const end = target.hookCallNode.getEnd();
          edits.push({
            start,
            end,
            replacement: newCallMatch[0],
          });
        }
      }
      continue;
    }

    // If target already declares t, skip
    if (target.declaresT) {
      continue;
    }

    // Target needs hook:
    // If target calls t(...) or if it's the primary component (or targets.length === 1)
    const shouldInject = target.callsT || targets.length === 1 || target.name !== undefined;
    if (!shouldInject && targets.length > 1) {
      continue;
    }

    const hookStmt = defaultHookValue.endsWith(";")
      ? defaultHookValue
      : `${defaultHookValue};`;

    if (target.isConciseArrow) {
      const bodyStart = target.body.getStart(sourceFile);
      const bodyEnd = target.body.getEnd();
      const bodyText = updatedText.slice(bodyStart, bodyEnd);
      const blockified = `{\n  ${hookStmt}\n  return ${bodyText};\n}`;
      edits.push({
        start: bodyStart,
        end: bodyEnd,
        replacement: blockified,
      });
    } else {
      const block = target.body as ts.Block;
      const indent = detectIndentation(block, sourceFile);
      const insertPos = block.getStart(sourceFile) + 1; // right after '{'
      edits.push({
        start: insertPos,
        end: insertPos,
        replacement: `\n${indent}${hookStmt}`,
      });
    }
  }

  // 2. Sort edits in descending order (highest offset first) so earlier offsets don't drift
  edits.sort((a, b) => b.start - a.start);

  for (const edit of edits) {
    updatedText =
      updatedText.slice(0, edit.start) +
      edit.replacement +
      updatedText.slice(edit.end);
  }

  return { updatedText, warnings, errors };
}

/**
 * Transforms a single source file by applying all planned replacements, imports, and hooks.
 */
export function applySourceChangesToFile(
  filePath: string,
  originalContent: string,
  sourceChanges: SourceChangePlan[]
): SourceTransformResult {
  const warnings: ApplyWarning[] = [];
  const errors: ApplyError[] = [];

  // Filter for REPLACE actions only
  const applicableChanges = sourceChanges.filter((sc) => sc.action === "REPLACE");
  if (applicableChanges.length === 0) {
    return {
      transformedContent: originalContent,
      changesApplied: 0,
      warnings,
      errors,
    };
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    originalContent,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  interface PreparedReplacement {
    startOffset: number;
    endOffset: number;
    replacement: string;
    expectedSource: string;
    plan: SourceChangePlan;
  }

  const preparedReplacements: PreparedReplacement[] = [];

  // 1. Validate all source locations and detect stale plans
  for (const sc of applicableChanges) {
    const startOffset = sourceFile.getPositionOfLineAndCharacter(
      sc.location.line - 1,
      sc.location.column - 1
    );

    const endLine = sc.location.endLine ?? sc.location.line;
    const endColumn = sc.location.endColumn ?? sc.location.column + sc.source.length;
    const endOffset = sourceFile.getPositionOfLineAndCharacter(
      endLine - 1,
      endColumn - 1
    );

    const actualSlice = originalContent.slice(startOffset, endOffset);

    if (!isSourceMatching(actualSlice, sc.source)) {
      errors.push({
        code: "PLAN_STALE",
        message: `Source file ${toPosixPath(filePath)}:${sc.location.line}:${sc.location.column} has changed since plan was generated. Expected: "${sc.source}", Found: "${actualSlice}"`,
        file: toPosixPath(filePath),
        details: {
          expected: sc.source,
          actual: actualSlice,
          location: sc.location,
        },
      });
      continue;
    }

    preparedReplacements.push({
      startOffset,
      endOffset,
      replacement: sc.replacement,
      expectedSource: sc.source,
      plan: sc,
    });
  }

  // If any replacement is stale, abort transformation for safety
  if (errors.length > 0) {
    return {
      transformedContent: originalContent,
      changesApplied: 0,
      warnings,
      errors,
    };
  }

  // 2. Sort prepared replacements in descending order (bottom-to-top)
  // This ensures earlier string character offsets do not drift!
  preparedReplacements.sort((a, b) => b.startOffset - a.startOffset);

  let transformed = originalContent;
  let changesApplied = 0;

  for (const rep of preparedReplacements) {
    transformed =
      transformed.slice(0, rep.startOffset) +
      rep.replacement +
      transformed.slice(rep.endOffset);
    changesApplied++;
  }

  // 3. Collect required code changes (imports and hooks)
  const codeChanges: CodeChange[] = [];
  for (const sc of applicableChanges) {
    if (sc.requiredCodeChanges) {
      for (const cc of sc.requiredCodeChanges) {
        if (!codeChanges.some((c) => c.type === cc.type && c.value === cc.value)) {
          codeChanges.push(cc);
        }
      }
    }
  }

  // 4. Inject imports if needed
  transformed = injectRequiredImports(transformed, codeChanges);

  // 5. Inject hooks if needed
  const hookResult = injectRequiredHooks(transformed, filePath, codeChanges);
  transformed = hookResult.updatedText;
  warnings.push(...hookResult.warnings);
  errors.push(...hookResult.errors);

  // 6. Safety net: Ensure i18n integrity
  const primaryNamespace =
    applicableChanges.find((sc) => sc.namespace)?.namespace || "common";
  transformed = ensureI18nIntegrity(transformed, filePath, primaryNamespace);

  // 7. Validate resulting syntax using TypeScript parser
  try {
    const checkFile = ts.createSourceFile(
      filePath,
      transformed,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );
    // If parse diagnostics exist
    const parseDiagnostics = (checkFile as unknown as { parseDiagnostics?: unknown[] })
      .parseDiagnostics;
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      warnings.push({
        code: "SYNTAX_CHECK_WARNING",
        message: `Transformed file ${toPosixPath(filePath)} generated syntax parser warnings.`,
        file: toPosixPath(filePath),
      });
    }
  } catch (err: unknown) {
    errors.push({
      code: "SYNTAX_ERROR_IN_TRANSFORMED_CODE",
      message: `Transformed code for ${toPosixPath(filePath)} failed syntax check: ${String(err)}`,
      file: toPosixPath(filePath),
    });
  }

  return {
    transformedContent: transformed,
    changesApplied,
    warnings,
    errors,
  };
}

/**
 * Safety net pass: Verifies that no transformed file calling `t(...)`, `<Trans>`,
 * or `i18n.t(...)` leaves the replacement pipeline without their required imports
 * and in-scope declarations.
 */
export function ensureI18nIntegrity(
  sourceText: string,
  filePath: string,
  defaultNamespace: string = "common"
): string {
  if (!/\.[jt]sx?$/i.test(filePath)) {
    return sourceText;
  }

  let result = sourceText;

  const sourceFile = ts.createSourceFile(
    filePath,
    result,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  let callsT = false;
  let callsTrans = false;
  let callsI18nT = false;

  function scanCalls(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const txt = node.expression.getText(sourceFile);
      if (txt === "t") callsT = true;
      if (txt === "i18n.t") callsI18nT = true;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (tag === "Trans") callsTrans = true;
    }
    ts.forEachChild(node, scanCalls);
  }
  scanCalls(sourceFile);

  const neededImports: CodeChange[] = [];

  // Check useTranslation import
  if (
    callsT &&
    !/import\s+{[^}]*\buseTranslation\b[^}]*}\s+from\s+['"]react-i18next['"]/.test(result)
  ) {
    neededImports.push({
      type: "ADD_IMPORT",
      value: "useTranslation",
      module: "react-i18next",
    });
  }

  // Check Trans import
  if (
    callsTrans &&
    !/import\s+{[^}]*\bTrans\b[^}]*}\s+from\s+['"]react-i18next['"]/.test(result)
  ) {
    neededImports.push({
      type: "ADD_IMPORT",
      value: "Trans",
      module: "react-i18next",
    });
  }

  // Check i18n import
  if (
    callsI18nT &&
    !/import\s+.*i18n.*from\s+['"].*['"]/.test(result)
  ) {
    neededImports.push({
      type: "ADD_IMPORT",
      value: "i18n",
      module: "i18next",
    });
  }

  if (neededImports.length > 0) {
    result = injectRequiredImports(result, neededImports);
  }

  // Ensure every component calling t(...) has t declared
  if (callsT) {
    const hookResult = injectRequiredHooks(result, filePath, [
      {
        type: "ADD_HOOK",
        value: `const { t } = useTranslation("${defaultNamespace}")`,
      },
    ]);
    result = hookResult.updatedText;
  }

  return result;
}
