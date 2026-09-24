import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class NextJsAdapter implements FrameworkAdapter {
  readonly id = "nextjs" as const;
  readonly displayName = "Next.js";
  readonly defaultLanguage = "typescript" as const;
  readonly fileExtensions = [".tsx", ".jsx", ".ts", ".js"];
  readonly defaultNamespaces = ["common"];

  private readonly textComponents = new Set([
    "p",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
    "Link",
    "label",
    "button",
    "Text",
    "Typography",
    "Image",
  ]);

  private readonly textProps = new Set([
    "title",
    "placeholder",
    "alt",
    "aria-label",
    "aria-description",
    "label",
    "description",
    "helperText",
    "errorMessage",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    return this.textComponents.has(componentName) || componentName.endsWith("Text");
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      lower === "alt" ||
      lower.startsWith("aria-") ||
      lower.endsWith("title") ||
      lower.endsWith("label")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return lower === "alert" || lower.includes("toast") || lower.includes("notify");
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import { useTranslations } from 'next-intl';",
      hookOrAccessor: "const t = useTranslations();",
      callSyntax: "t",
    };
  }
}
