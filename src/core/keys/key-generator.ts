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

export function generateSemanticKey(text: string, contextPrefix?: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Check known action phrases directly
  if (COMMON_ACTION_MAP[lower]) {
    return COMMON_ACTION_MAP[lower]!;
  }

  // Remove interpolation patterns e.g. {{name}} or ${name}
  let clean = trimmed
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, ""); // strip HTML/JSX tags if any

  // Replace special characters / punctuation with spaces
  clean = clean.replace(/[^a-zA-Z0-9\s]/g, " ").trim();

  if (!clean) {
    return contextPrefix ? `${contextPrefix.toUpperCase()}_TEXT` : "TEXT";
  }

  // Split into words
  const words = clean
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase());

  // Cap at 5 words to avoid huge sentence keys
  const selectedWords = words.slice(0, 5);

  const key = selectedWords.join("_");
  return key || "KEY";
}
