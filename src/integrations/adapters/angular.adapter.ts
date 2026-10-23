import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class AngularAdapter implements FrameworkAdapter {
  readonly id = "angular" as const;
  readonly displayName = "Angular";
  readonly defaultLanguage = "typescript" as const;
  readonly fileExtensions = [".ts", ".html"];
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
    "li",
    "td",
    "th",
    "option",
    "mat-card-title",
    "mat-card-subtitle",
    "mat-card-content",
    "mat-dialog-title",
    "mat-dialog-content",
    "mat-panel-title",
    "mat-panel-description",
    "mat-toolbar",
    "mat-header-cell",
    "mat-cell",
    "mat-hint",
    "mat-error",
    "mat-label",
    "mat-option",
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
    "matTooltip",
    "hintLabel",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    const lower = componentName.toLowerCase();
    return (
      this.textComponents.has(lower) ||
      this.textComponents.has(componentName) ||
      lower.endsWith("text") ||
      lower.endsWith("title") ||
      lower.endsWith("label")
    );
  }

  isKnownTextProp(propName: string): boolean {
    const lower = propName.toLowerCase();
    return (
      this.textProps.has(propName) ||
      this.textProps.has(lower) ||
      lower === "alt" ||
      lower.startsWith("aria-") ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("placeholder") ||
      lower.endsWith("tooltip") ||
      lower.endsWith("text")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower === "alert" ||
      lower.includes("toast") ||
      lower.includes("snackbar") ||
      lower.includes("dialog") ||
      lower.includes("notify")
    );
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import { TranslateService } from '@ngx-translate/core';",
      hookOrAccessor: "private translate = inject(TranslateService);",
      callSyntax: "this.translate.instant",
    };
  }
}
