export type FormalityType = "formal" | "informal" | "neutral";

export interface TranslationContext {
  /** UI element role or classification, e.g. "BUTTON", "TITLE", "PLACEHOLDER", "ERROR_MESSAGE", "TOOLTIP" */
  role?: string;
  /** Enclosing component name or function, e.g. "FlightBookingModal", "LoginForm", "CheckoutScreen" */
  componentName?: string;
  /** Enclosing HTML/JSX tag or callee, e.g. "<button>", "<input>", "Alert.alert", "SnackBar" */
  elementTag?: string;
  /** Property name if attribute string, e.g. "placeholder", "title", "aria-label", "label" */
  propName?: string;
  /** Source file path, e.g. "src/features/checkout/OrderSummary.tsx" */
  filePath?: string;
  /** Context description or translator notes (e.g. from Flutter ARB @description or developer comments) */
  description?: string;
  /** Desired tone / grammatical formality */
  formality?: FormalityType;
  /** Maximum length constraint in characters */
  maxLength?: number;
  /** Surrounding text or labels */
  surroundingText?: string;
}

/**
 * Infers a UI role from semantic translation key naming patterns.
 */
export function inferRoleFromKey(key: string): string | undefined {
  const upper = key.toUpperCase();

  if (
    upper.endsWith("_BUTTON") ||
    upper.endsWith("_BTN") ||
    upper.endsWith("_ACTION") ||
    upper.startsWith("BTN_")
  ) {
    return "BUTTON (interactive action label)";
  }

  if (
    upper.endsWith("_TITLE") ||
    upper.endsWith("_HEADER") ||
    upper.endsWith("_HEADING") ||
    upper.startsWith("TITLE_") ||
    upper.startsWith("HEADER_")
  ) {
    return "TITLE (page, modal, or section header)";
  }

  if (
    upper.endsWith("_PLACEHOLDER") ||
    upper.endsWith("_HINT") ||
    upper.startsWith("HINT_") ||
    upper.startsWith("PLACEHOLDER_")
  ) {
    return "PLACEHOLDER (input field prompt)";
  }

  if (
    upper.endsWith("_ERROR") ||
    upper.endsWith("_ERR") ||
    upper.endsWith("_INVALID") ||
    upper.startsWith("ERR_") ||
    upper.startsWith("ERROR_")
  ) {
    return "ERROR_MESSAGE (alert or validation warning)";
  }

  if (upper.endsWith("_SUCCESS") || upper.startsWith("SUCCESS_")) {
    return "SUCCESS_MESSAGE (confirmation feedback)";
  }

  if (
    upper.endsWith("_TOOLTIP") ||
    upper.endsWith("_HELP") ||
    upper.endsWith("_INFO") ||
    upper.startsWith("TOOLTIP_") ||
    upper.startsWith("HELP_") ||
    upper.startsWith("INFO_")
  ) {
    return "TOOLTIP (help/explanatory popover text)";
  }

  if (
    upper.endsWith("_DESC") ||
    upper.endsWith("_DESCRIPTION") ||
    upper.endsWith("_SUBTITLE") ||
    upper.startsWith("DESC_") ||
    upper.startsWith("DESCRIPTION_")
  ) {
    return "DESCRIPTION (secondary body explanation)";
  }

  if (
    upper.endsWith("_TAB") ||
    upper.endsWith("_NAV") ||
    upper.endsWith("_MENU") ||
    upper.startsWith("TAB_") ||
    upper.startsWith("NAV_") ||
    upper.startsWith("MENU_")
  ) {
    return "NAVIGATION (tab, menu, or bar item)";
  }

  return undefined;
}

/**
 * Builds a structured, prompt-friendly context block for AI translation providers (OpenAI, Gemini).
 */
export function buildContextPrompt(context?: TranslationContext): string {
  if (!context) return "";

  const lines: string[] = [];

  if (context.role) {
    lines.push(`UI Role: ${context.role}`);
  }

  if (context.componentName) {
    lines.push(`Component: <${context.componentName}>`);
  }

  if (context.elementTag) {
    lines.push(`Element: <${context.elementTag}>`);
  }

  if (context.propName) {
    lines.push(`Attribute/Prop: ${context.propName}`);
  }

  if (context.filePath) {
    lines.push(`File Source: ${context.filePath}`);
  }

  if (context.description) {
    lines.push(`Context/Note: ${context.description}`);
  }

  if (context.formality && context.formality !== "neutral") {
    const formalityDesc =
      context.formality === "formal"
        ? "Formal (use polite/formal address, e.g. German 'Sie', French 'vous', Spanish 'usted')"
        : "Informal (use casual/friendly address, e.g. German 'du', French 'tu', Spanish 'tú')";
    lines.push(`Grammatical Formality: ${formalityDesc}`);
  }

  if (context.maxLength && context.maxLength > 0) {
    lines.push(`Length Constraint: Keep translation within ~${context.maxLength} characters to prevent UI overflow.`);
  }

  if (context.surroundingText) {
    lines.push(`Surrounding UI Context: "${context.surroundingText}"`);
  }

  if (lines.length === 0) return "";

  return (
    `\nContextual Clues for Disambiguation & Style:\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\nUse this context to accurately resolve polysemy, parts of speech (verb vs noun vs adjective), and grammatical gender suitable for software UI.`
  );
}
