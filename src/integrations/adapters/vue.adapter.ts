import type { FrameworkAdapter } from "./framework-adapter.interface.js";

export class VueAdapter implements FrameworkAdapter {
  readonly id = "vue" as const;
  readonly displayName = "Vue / Nuxt";
  readonly defaultLanguage = "typescript" as const;
  readonly fileExtensions = [".vue", ".ts", ".js", ".tsx", ".jsx"];
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
    "router-link",
    "nuxt-link",
    "el-button",
    "el-card",
    "el-tag",
    "v-btn",
    "v-card-title",
    "v-card-text",
    "v-list-item-title",
    "v-alert",
    "n-button",
    "n-card",
    "n-text",
  ]);

  private readonly textProps = new Set([
    "title",
    "placeholder",
    "alt",
    "aria-label",
    "aria-description",
    "aria-placeholder",
    "label",
    "helper-text",
    "helperText",
    "error-message",
    "errorMessage",
    "hint",
    "tooltip",
  ]);

  isKnownTextComponent(componentName: string): boolean {
    const lower = componentName.toLowerCase();
    return (
      this.textComponents.has(lower) ||
      this.textComponents.has(componentName) ||
      lower.endsWith("text") ||
      lower.endsWith("title") ||
      lower.endsWith("label") ||
      lower.endsWith("btn") ||
      lower.endsWith("button")
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
      lower.endsWith("text") ||
      lower.endsWith("hint")
    );
  }

  isKnownFeedbackCall(calleeName: string): boolean {
    const lower = calleeName.toLowerCase();
    return (
      lower === "alert" ||
      lower === "confirm" ||
      lower.includes("toast") ||
      lower.includes("notify") ||
      lower.includes("message") ||
      lower.includes("dialog")
    );
  }

  getDefaultTranslationPattern() {
    return {
      importStatement: "import { useI18n } from 'vue-i18n';",
      hookOrAccessor: "const { t } = useI18n();",
      callSyntax: "t",
    };
  }
}
