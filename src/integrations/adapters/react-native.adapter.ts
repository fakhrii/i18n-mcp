import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class ReactNativeAdapter implements FrameworkAdapter {
  readonly id = "react-native" as const;
  readonly displayName = "React Native";
  readonly defaultLanguage = "typescript" as const;
  readonly fileExtensions = [".tsx", ".jsx", ".ts", ".js"];
  readonly defaultNamespaces = ["common"];

  private readonly textComponents = new Set([
    "Text",
    "Animated.Text",
    "AppText",
    "Typography",
    "Paragraph",
    "Title",
    "Heading",
    "Subheading",
    "Label",
    "Caption",
  ]);

  private readonly textProps = new Set([
    "title",
    "headerTitle",
    "label",
    "placeholder",
    "description",
    "message",
    "helperText",
    "error",
    "errorMessage",
    "errorText",
    "accessibilityLabel",
    "accessibilityHint",
    "subtitle",
    "prompt",
    "confirmText",
    "cancelText",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    return this.textComponents.has(componentName) || componentName.endsWith("Text");
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("message") ||
      lower.endsWith("placeholder")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower === "alert.alert" ||
      lower === "alert" ||
      lower.includes("toast") ||
      lower.includes("snackbar") ||
      lower.includes("dialog") ||
      lower === "seterror" ||
      lower === "setfielderror"
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
