import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class AndroidAdapter implements FrameworkAdapter {
  readonly id = "android" as const;
  readonly displayName = "Android (Kotlin / Compose)";
  readonly defaultLanguage = "kotlin" as const;
  readonly fileExtensions = [".kt", ".xml"];
  readonly defaultNamespaces = ["strings"];

  private readonly textComponents = new Set([
    "Text",
    "BasicText",
    "Button",
    "OutlinedTextField",
    "TextField",
    "Icon",
    "Tab",
  ]);

  private readonly textProps = new Set([
    "text",
    "label",
    "placeholder",
    "contentDescription",
    "hint",
    "title",
    "supportingText",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    return this.textComponents.has(componentName);
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      lower.endsWith("text") ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("hint")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower.includes("toast") ||
      lower.includes("snackbar") ||
      lower.includes("alertdialog")
    );
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import androidx.compose.ui.res.stringResource",
      hookOrAccessor: "",
      callSyntax: "stringResource(R.string...)",
    };
  }
}
