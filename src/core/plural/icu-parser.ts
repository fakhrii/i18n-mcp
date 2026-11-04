export interface ParsedIcuBranch {
  selector: string;
  content: string;
}

export interface ParsedIcuClause {
  fullMatch: string;
  startIndex: number;
  endIndex: number;
  type: "plural" | "select";
  variable: string;
  offset?: number;
  branches: ParsedIcuBranch[];
}

/**
 * Parses all ICU plural and select clauses within a text string.
 * Accurately handles nested braces, interpolation variables, and offsets.
 */
export function parseIcuClauses(text: string): ParsedIcuClause[] {
  const clauses: ParsedIcuClause[] = [];
  const headerRegex = /\{([a-zA-Z0-9_]+)\s*,\s*(plural|select)\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(text)) !== null) {
    const startIndex = match.index;
    const variable = match[1]!;
    const type = match[2]! as "plural" | "select";
    let index = match.index + match[0].length;
    let offset: number | undefined;

    // Check optional offset:N for plurals
    if (type === "plural") {
      const rest = text.slice(index);
      const offsetMatch = rest.match(/^\s*offset\s*:\s*([0-9]+)\s*/i);
      if (offsetMatch && offsetMatch[1]) {
        offset = parseInt(offsetMatch[1], 10);
        index += offsetMatch[0].length;
      }
    }

    const branches: ParsedIcuBranch[] = [];
    let outerClosed = false;

    // Parse branches within the clause until outer '}' closes
    while (index < text.length && !outerClosed) {
      // Skip whitespace
      while (index < text.length && /\s/.test(text[index]!)) {
        index++;
      }

      if (index >= text.length) break;

      // If we see the outer closing brace
      if (text[index] === "}") {
        index++;
        outerClosed = true;
        break;
      }

      // Read selector: =N or identifier (word)
      const selectorMatch = text.slice(index).match(/^(=[0-9]+|[a-zA-Z0-9_]+)\s*\{/);
      if (!selectorMatch || !selectorMatch[1]) {
        // Unknown syntax, advance to avoid infinite loop
        index++;
        continue;
      }

      const selector = selectorMatch[1];
      index += selectorMatch[0].length; // Now index is right inside '{'

      // Extract branch content balancing braces
      let depth = 1;
      const contentStart = index;

      while (index < text.length && depth > 0) {
        if (text[index] === "{") {
          depth++;
        } else if (text[index] === "}") {
          depth--;
        }
        if (depth > 0) {
          index++;
        }
      }

      if (depth === 0) {
        const content = text.slice(contentStart, index);
        branches.push({ selector, content });
        index++; // advance past '}'
      }
    }

    if (branches.length > 0) {
      const fullMatch = text.slice(startIndex, index);
      clauses.push({
        fullMatch,
        startIndex,
        endIndex: index,
        type,
        variable,
        offset,
        branches,
      });
      // Move regex search position after this clause
      headerRegex.lastIndex = index;
    }
  }

  return clauses;
}

/**
 * Rebuilds an ICU clause string from its parsed structure and updated branches.
 */
export function serializeIcuClause(
  variable: string,
  type: "plural" | "select",
  branches: ParsedIcuBranch[],
  offset?: number
): string {
  const parts: string[] = [variable, type];
  if (offset !== undefined) {
    parts.push(`offset:${offset}`);
  }

  const branchStrings = branches.map((b) => `${b.selector}{${b.content}}`).join(" ");
  return `{${parts.join(", ")}, ${branchStrings}}`;
}

/**
 * Injects missing plural categories into an existing ICU plural clause.
 * Uses the 'other' branch (or last available branch) as the template for missing categories.
 */
export function injectMissingIcuBranches(
  originalText: string,
  clause: ParsedIcuClause,
  missingCategories: string[]
): string {
  const templateBranch =
    clause.branches.find((b) => b.selector === "other") ||
    clause.branches[clause.branches.length - 1];

  const templateContent = templateBranch ? templateBranch.content : `#`;

  // Preserve existing order and inject missing ones
  const existingSelectors = new Set(clause.branches.map((b) => b.selector));
  const newBranches: ParsedIcuBranch[] = [...clause.branches];

  for (const missingCat of missingCategories) {
    if (!existingSelectors.has(missingCat)) {
      newBranches.push({
        selector: missingCat,
        content: templateContent,
      });
    }
  }

  const serialized = serializeIcuClause(
    clause.variable,
    clause.type,
    newBranches,
    clause.offset
  );

  return (
    originalText.slice(0, clause.startIndex) +
    serialized +
    originalText.slice(clause.endIndex)
  );
}
