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
 */
export function injectRequiredImports(
  sourceText: string,
  codeChanges: CodeChange[]
): string {
  let result = sourceText;

  for (const change of codeChanges) {
    if (change.type === "ADD_IMPORT" && change.module === "react-i18next") {
      const importItem = change.value; // e.g. "useTranslation"

      // Check if module is already imported
      const moduleImportRegex =
        /import\s+\{([^}]+)\}\s+from\s+['"]react-i18next['"];?/;
      const match = result.match(moduleImportRegex);

      if (match) {
        const existingImports = match[1]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (!existingImports.includes(importItem)) {
          const updatedImports = [...existingImports, importItem].join(", ");
          const replacement = `import { ${updatedImports} } from "react-i18next";`;
          result = result.replace(match[0], replacement);
        }
      } else {
        // Find position of the last existing import statement
        const allImports = Array.from(
          result.matchAll(/^import\s+.*from\s+['"].*['"];?/gm)
        );

        if (allImports.length > 0) {
          const lastImport = allImports[allImports.length - 1]!;
          const insertPos = (lastImport.index ?? 0) + lastImport[0].length;
          result =
            result.slice(0, insertPos) +
            `\nimport { ${importItem} } from "react-i18next";` +
            result.slice(insertPos);
        } else {
          // Add at the very beginning
          result = `import { ${importItem} } from "react-i18next";\n` + result;
        }
      }
    }
  }

  return result;
}

/**
 * Injects required hook declarations (e.g. `const { t } = useTranslation("auth");`)
 * into the top of the enclosing React functional component body.
 */
export function injectRequiredHooks(
  sourceText: string,
  filePath: string,
  codeChanges: CodeChange[]
): { updatedText: string; warnings: ApplyWarning[]; errors: ApplyError[] } {
  const warnings: ApplyWarning[] = [];
  const errors: ApplyError[] = [];
  let updatedText = sourceText;

  const hookChanges = codeChanges.filter((c) => c.type === "ADD_HOOK");
  if (hookChanges.length === 0) {
    return { updatedText, warnings, errors };
  }

  for (const hc of hookChanges) {
    // If hook is already called in the file, skip
    if (
      updatedText.includes("useTranslation(") ||
      updatedText.includes(hc.value)
    ) {
      continue;
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

    let targetInsertPos: number | null = null;
    let indent = "  ";

    // Traverse AST to locate the primary component function
    function findComponentBody(node: ts.Node): void {
      if (targetInsertPos !== null) return;

      // 1. Function declaration: function MyComponent(...) { ... }
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        const name = node.name.text;
        if (/^[A-Z]/.test(name)) {
          // Insert after opening brace
          targetInsertPos = node.body.getStart(sourceFile) + 1;
          return;
        }
      }

      // 2. Variable declaration: const MyComponent = (...) => { ... }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /^[A-Z]/.test(node.name.text) &&
        node.initializer
      ) {
        let funcBody: ts.Node | undefined;
        if (ts.isArrowFunction(node.initializer)) {
          funcBody = node.initializer.body;
        } else if (ts.isFunctionExpression(node.initializer)) {
          funcBody = node.initializer.body;
        }

        if (funcBody && ts.isBlock(funcBody)) {
          targetInsertPos = funcBody.getStart(sourceFile) + 1;
          return;
        }
      }

      ts.forEachChild(node, findComponentBody);
    }

    findComponentBody(sourceFile);

    if (targetInsertPos !== null) {
      const insertion = `\n${indent}${hc.value};`;
      updatedText =
        updatedText.slice(0, targetInsertPos) +
        insertion +
        updatedText.slice(targetInsertPos);
    } else {
      warnings.push({
        code: "HOOK_INJECTION_SKIPPED",
        message: `Could not safely locate top-level React component body to inject hook: "${hc.value}"`,
        file: toPosixPath(filePath),
      });
    }
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

  // 6. Validate resulting syntax using TypeScript parser
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
