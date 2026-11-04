import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class IosAdapter implements FrameworkAdapter {
  readonly id = "ios" as const;
  readonly displayName = "iOS (Swift / SwiftUI)";
  readonly defaultLanguage = "swift" as const;
  readonly fileExtensions = [".swift"];
  readonly defaultNamespaces = ["Localizable"];

  private readonly textComponents = new Set([
    "Text",
    "Label",
    "Button",
    "TextField",
    "SecureField",
    "Toggle",
    "NavigationTitle",
  ]);

  private readonly textProps = new Set([
    "title",
    "prompt",
    "placeholder",
    "label",
    "accessibilityLabel",
    "accessibilityHint",
    "help",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    return this.textComponents.has(componentName);
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("prompt")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower.includes("alert") ||
      lower.includes("confirmationdialog") ||
      lower.includes("sheet")
    );
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import SwiftUI",
      hookOrAccessor: "",
      callSyntax: "String(localized: ...)",
    };
  }
}
