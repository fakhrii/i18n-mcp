import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class ReactWebAdapter implements FrameworkAdapter {
  readonly id = "react" as const;
  readonly displayName = "React (Web)";
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
    "label",
    "button",
    "small",
    "strong",
    "em",
    "b",
    "i",
    "Text",
    "Typography",
  ]);

  private readonly textProps = new Set([
    "title",
    "placeholder",
    "alt",
    "aria-label",
    "aria-description",
    "aria-placeholder",
    "aria-roledescription",
    "label",
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
      lower.startsWith("aria-") ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("placeholder")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower === "alert" ||
      lower.includes("toast") ||
      lower.includes("notify") ||
      lower.includes("snackbar")
    );
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import { useTranslation } from 'react-i18next';",
      hookOrAccessor: "const { t } = useTranslation();",
      callSyntax: "t",
    };
  }
}
