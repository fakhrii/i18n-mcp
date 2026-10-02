import ts from "typescript";

export interface RichTextExtraction {
  compositeText: string;
  components: Record<string, string>;
  rawText: string;
  handledChildNodes: ts.Node[];
}

const INLINE_TAGS = new Set([
  "text",
  "a",
  "link",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "span",
  "small",
  "code",
  "abbr",
  "sub",
  "sup",
]);

const TEXT_CONTAINERS = new Set([
  "text",
  "p",
  "span",
  "div",
  "typography",
  "label",
  "heading",
  "title",
  "body",
]);

function deriveTagName(
  tagName: string,
  innerText: string,
  hasLinkOrPress: boolean,
  usedNames: Set<string>
): string {
  const lowerTag = tagName.toLowerCase();
  let baseName = "tag";

  if (lowerTag === "b" || lowerTag === "strong") {
    baseName = "bold";
  } else if (lowerTag === "i" || lowerTag === "em") {
    baseName = "italic";
  } else if (lowerTag === "u") {
    baseName = "underline";
  } else if (hasLinkOrPress || lowerTag === "a" || lowerTag === "link") {
    const firstWord = innerText
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    if (
      firstWord &&
      firstWord.length > 2 &&
      firstWord !== "here" &&
      firstWord !== "click"
    ) {
      baseName = `${firstWord}Link`;
    } else {
      baseName = "link";
    }
  } else {
    const firstWord = innerText
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    if (firstWord && firstWord.length > 2) {
      baseName = `${firstWord}Text`;
    } else {
      baseName = lowerTag.length > 0 ? lowerTag : "comp";
    }
  }

  // Ensure unique name
  let name = baseName;
  let counter = 1;
  while (usedNames.has(name)) {
    name = `${baseName}${counter++}`;
  }
  usedNames.add(name);
  return name;
}

/**
 * Checks if a JSX element is a rich text container with mixed text and inline elements.
 */
export function extractRichTextJsx(
  node: ts.JsxElement,
  sourceFile: ts.SourceFile
): RichTextExtraction | null {
  const openingTag = node.openingElement.tagName.getText(sourceFile);
  const lowerOpening = openingTag.toLowerCase();

  // Must be a recognized text container or end with Text/Paragraph/Label
  const isContainer =
    TEXT_CONTAINERS.has(lowerOpening) ||
    lowerOpening.endsWith("text") ||
    lowerOpening.endsWith("label") ||
    lowerOpening.endsWith("paragraph");

  if (!isContainer) return null;

  const children = node.children;
  if (!children || children.length < 2) return null;

  // Verify that children contain at least one text node and at least one inline JSX element
  let hasText = false;
  let hasInlineJsx = false;

  for (const child of children) {
    if (ts.isJsxText(child)) {
      if (child.getText(sourceFile).trim().length > 0) {
        hasText = true;
      }
    } else if (ts.isJsxExpression(child) && child.expression) {
      if (
        ts.isStringLiteral(child.expression) ||
        ts.isNoSubstitutionTemplateLiteral(child.expression) ||
        ts.isIdentifier(child.expression)
      ) {
        hasText = true;
      }
    } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const childTagName = (
        ts.isJsxElement(child) ? child.openingElement.tagName : child.tagName
      )
        .getText(sourceFile)
        .toLowerCase();

      // Inline elements only (not container components like View, ScrollView, Form, etc.)
      if (
        INLINE_TAGS.has(childTagName) ||
        childTagName.endsWith("text") ||
        childTagName.endsWith("link") ||
        childTagName.endsWith("span")
      ) {
        hasInlineJsx = true;
      }
    }
  }

  if (!hasText || !hasInlineJsx) return null;

  // Synthesize rich text template and extract component definitions
  const components: Record<string, string> = {};
  const usedTagNames = new Set<string>();
  const handledChildNodes: ts.Node[] = [];
  let compositeText = "";

  for (const child of children) {
    handledChildNodes.push(child);

    if (ts.isJsxText(child)) {
      const raw = sourceFile.text.slice(child.pos, child.end);
      const normalized = raw.replace(/\s+/g, " ");
      compositeText += normalized;
    } else if (ts.isJsxExpression(child)) {
      if (child.expression && ts.isIdentifier(child.expression)) {
        compositeText += `{{${child.expression.text}}}`;
      } else if (child.expression && ts.isStringLiteral(child.expression)) {
        compositeText += child.expression.text;
      }
    } else if (ts.isJsxElement(child)) {
      const childOpening = child.openingElement;
      const childTagName = childOpening.tagName.getText(sourceFile);
      const childOpeningText = childOpening.getText(sourceFile);

      // Extract child's inner text
      let innerText = "";
      for (const grandChild of child.children) {
        handledChildNodes.push(grandChild);
        if (ts.isJsxText(grandChild)) {
          innerText += sourceFile.text.slice(grandChild.pos, grandChild.end).replace(/\s+/g, " ");
        } else if (
          ts.isJsxExpression(grandChild) &&
          grandChild.expression &&
          ts.isStringLiteral(grandChild.expression)
        ) {
          innerText += grandChild.expression.text;
        }
      }

      // Check if child has link, touchable, or link style attributes
      const hasLinkOrPress =
        childOpeningText.includes("onPress") ||
        childOpeningText.includes("onClick") ||
        childOpeningText.includes("href") ||
        childOpeningText.includes("to=") ||
        childOpeningText.toLowerCase().includes("link");

      const derivedTag = deriveTagName(
        childTagName,
        innerText,
        hasLinkOrPress,
        usedTagNames
      );

      // Self-closing component definition without the closing tag and inner text
      // e.g. <Text style={styles.link} onPress={openTerms} />
      let compDef = childOpeningText;
      if (compDef.endsWith(">")) {
        compDef = compDef.slice(0, -1).trimEnd() + " />";
      }

      components[derivedTag] = compDef;
      compositeText += `<${derivedTag}>${innerText.trim()}</${derivedTag}>`;
    } else if (ts.isJsxSelfClosingElement(child)) {
      const childTagName = child.tagName.getText(sourceFile);
      const childText = child.getText(sourceFile);
      const derivedTag = deriveTagName(childTagName, "", false, usedTagNames);
      components[derivedTag] = childText;
      compositeText += `<${derivedTag} />`;
    }
  }

  // Clean edge whitespace while keeping interior layout clean
  compositeText = compositeText.replace(/\s+/g, " ").trim();

  return {
    compositeText,
    components,
    rawText: node.getText(sourceFile),
    handledChildNodes,
  };
}
