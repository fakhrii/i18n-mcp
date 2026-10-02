const COMMON_ACTION_MAP: Record<string, string> = {
  save: "SAVE",
  cancel: "CANCEL",
  close: "CLOSE",
  delete: "DELETE",
  confirm: "CONFIRM",
  continue: "CONTINUE",
  back: "BACK",
  next: "NEXT",
  loading: "LOADING",
  "loading...": "LOADING",
  retry: "RETRY",
  "try again": "TRY_AGAIN",
  "try again later": "TRY_AGAIN_LATER",
  "log in": "LOGIN",
  login: "LOGIN",
  "sign in": "SIGN_IN",
  signin: "SIGN_IN",
  "sign up": "SIGN_UP",
  signup: "SIGN_UP",
  "log out": "LOGOUT",
  logout: "LOGOUT",
  "sign out": "SIGN_OUT",
  signout: "SIGN_OUT",
  "ok": "OK",
  "done": "DONE",
  "submit": "SUBMIT",
  "edit": "EDIT",
  "search": "SEARCH",
  "view all": "VIEW_ALL",
  "see all": "SEE_ALL",
  "forgot password?": "FORGOT_PASSWORD",
  "welcome back": "WELCOME_BACK",
};

export type KeyNamingStyle =
  | "UPPER_SNAKE_CASE"
  | "lowerCamelCase"
  | "camelCase"
  | "snake_case"
  | "kebab-case";

export function formatKeyByStyle(words: string[], style: KeyNamingStyle = "UPPER_SNAKE_CASE"): string {
  if (words.length === 0) return "KEY";

  switch (style) {
    case "lowerCamelCase":
    case "camelCase": {
      const first = words[0]!.toLowerCase();
      const rest = words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      return first + rest.join("");
    }
    case "snake_case":
      return words.map((w) => w.toLowerCase()).join("_");
    case "kebab-case":
      return words.map((w) => w.toLowerCase()).join("-");
    case "UPPER_SNAKE_CASE":
    default:
      return words.map((w) => w.toUpperCase()).join("_");
  }
}

export function generateSemanticKey(
  text: string,
  contextPrefix?: string,
  keyStyle: KeyNamingStyle = "UPPER_SNAKE_CASE"
): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Check known action phrases directly
  if (COMMON_ACTION_MAP[lower]) {
    const actionKey = COMMON_ACTION_MAP[lower]!;
    if (keyStyle === "UPPER_SNAKE_CASE") return actionKey;
    const words = actionKey.split("_");
    return formatKeyByStyle(words, keyStyle);
  }

  // Remove interpolation patterns e.g. {{name}} or ${name}
  let clean = trimmed
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, ""); // strip HTML/JSX tags if any

  // Replace special characters / punctuation with spaces
  clean = clean.replace(/[^a-zA-Z0-9\s]/g, " ").trim();

  if (!clean) {
    if (contextPrefix) {
      const words = [contextPrefix, "TEXT"];
      return formatKeyByStyle(words, keyStyle);
    }
    return formatKeyByStyle(["TEXT"], keyStyle);
  }

  // Split into words
  const words = clean
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

  // Cap at 5 words to avoid huge sentence keys
  const selectedWords = words.slice(0, 5);

  return formatKeyByStyle(selectedWords, keyStyle) || "KEY";
}
