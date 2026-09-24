import type { InternationalizeInput } from "../models/internationalize.js";

const LANGUAGE_CODE_MAP: Record<string, string> = {
  english: "en",
  french: "fr",
  spanish: "es",
  german: "de",
  arabic: "ar",
  italian: "it",
  portuguese: "pt",
  japanese: "ja",
  chinese: "zh",
  russian: "ru",
  dutch: "nl",
  korean: "ko",
  turkish: "tr",
  polish: "pl",
  swedish: "sv",
  hindi: "hi",
};

export interface ParseOptions {
  activeContextFile?: string;
  projectPath?: string;
}

/**
 * Parses user command strings or natural language prompts into strongly typed InternationalizeInput.
 *
 * Guarantees conservative safety defaults:
 * - dryRun: true (unless explicitly --apply or user confirmed to apply)
 * - apply: false (unless explicitly --apply or user confirmed to apply)
 * - translate: false (unless explicitly requested)
 */
export function parseInternationalizeCommand(
  rawInput: string,
  options?: ParseOptions
): InternationalizeInput {
  const input = rawInput.trim();

  const result: InternationalizeInput = {
    projectPath: options?.projectPath,
    dryRun: true,
    apply: false,
    translate: false,
  };

  // 1. Detect apply / confirmation intent
  const isApplyOnlyPrompt =
    /^(yes,?\s*)?(apply|apply changes|confirm and apply|proceed with apply|go ahead and apply)\b/i.test(
      input
    );
  const hasApplyFlag = /--apply\b/i.test(input);
  const hasDryRunFlag = /--(dry-run|dryRun)\b/i.test(input);

  if (isApplyOnlyPrompt || hasApplyFlag) {
    result.apply = true;
    result.dryRun = false;
  }
  // Explicit --dry-run flag always forces dryRun: true and apply: false
  if (hasDryRunFlag) {
    result.dryRun = true;
    result.apply = false;
  }

  // 2. Detect translation intent and flags
  const hasTranslateFlag = /--translate\b/i.test(input);
  const mentionsTranslate =
    /\b(translate|translated|translation)\b/i.test(input);

  if (hasTranslateFlag || mentionsTranslate) {
    result.translate = true;
  }

  // 3. Detect backup and warning flags
  if (/--(create-backup|backup)\b/i.test(input)) {
    result.createBackup = true;
  }
  if (/--fail-on-warnings\b/i.test(input)) {
    result.failOnWarnings = true;
  }

  // 4. Extract explicit flags with values (--flag=value or --flag value)
  // Target locales: --target-locales=fr,ar or --target-locales fr,ar or --targetLocales=...
  const targetLocalesMatch =
    input.match(/--(?:target-locales|targetLocales)(?:=|\s+)([^\s]+)/i) ||
    input.match(/--to(?:=|\s+)([^\s]+)/i);

  if (targetLocalesMatch && targetLocalesMatch[1]) {
    result.targetLocales = targetLocalesMatch[1]
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    result.translate = true;
  } else {
    // Extract target locales from natural language, e.g.:
    // "translate to French and Arabic", "translate into Spanish", "to fr, es"
    const naturalLangMatch = input.match(
      /\b(?:translate\s+(?:to|into)|to)\s+([a-zA-Z\s,-]+?)(?:\s+and\s+([a-zA-Z\s,-]+?))?(?:\.|$|--)/i
    );
    if (naturalLangMatch && mentionsTranslate) {
      const locales: string[] = [];
      const parts = [naturalLangMatch[1], naturalLangMatch[2]].filter(Boolean);
      for (const part of parts) {
        const words = (part || "").split(/[\s,]+/).map((w) => w.trim().toLowerCase());
        for (const word of words) {
          if (!word || ["and", "with", "into", "the"].includes(word)) continue;
          if (LANGUAGE_CODE_MAP[word]) {
            locales.push(LANGUAGE_CODE_MAP[word]);
          } else if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(word)) {
            locales.push(word);
          }
        }
      }
      if (locales.length > 0) {
        result.targetLocales = Array.from(new Set(locales));
      }
    }
  }

  // Source locale: --source-locale=en
  const sourceLocaleMatch = input.match(
    /--(?:source-locale|sourceLocale)(?:=|\s+)([^\s]+)/i
  );
  if (sourceLocaleMatch && sourceLocaleMatch[1]) {
    result.sourceLocale = sourceLocaleMatch[1].trim().toLowerCase();
  }

  // Namespaces: --namespaces=auth,common
  const namespacesMatch = input.match(
    /--(?:namespaces|namespace)(?:=|\s+)([^\s]+)/i
  );
  if (namespacesMatch && namespacesMatch[1]) {
    result.namespaces = namespacesMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Include / Exclude
  const includeMatch = input.match(/--include(?:=|\s+)([^\s]+)/i);
  if (includeMatch && includeMatch[1]) {
    result.include = includeMatch[1].split(",").map((s) => s.trim());
  }
  const excludeMatch = input.match(/--exclude(?:=|\s+)([^\s]+)/i);
  if (excludeMatch && excludeMatch[1]) {
    result.exclude = excludeMatch[1].split(",").map((s) => s.trim());
  }

  // 5. Extract Scopes
  const extractedScopes: string[] = [];

  // If command starts with /internationalize, extract positional arguments
  if (input.startsWith("/internationalize")) {
    const tokens = input
      .slice("/internationalize".length)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) continue;
      if (token.startsWith("--")) {
        // Skip flag and its value if separated by space
        if (
          [
            "--target-locales",
            "--targetlocales",
            "--to",
            "--source-locale",
            "--sourcelocale",
            "--namespaces",
            "--namespace",
            "--include",
            "--exclude",
          ].includes(token.toLowerCase())
        ) {
          i++; // Skip argument
        }
        continue;
      }
      extractedScopes.push(token);
    }
  } else {
    // Natural language parsing for scope
    // Case 1: "this screen" or "current screen" or "this file"
    if (
      /\b(this\s+screen|current\s+screen|this\s+file|current\s+file)\b/i.test(
        input
      )
    ) {
      if (options?.activeContextFile) {
        extractedScopes.push(options.activeContextFile);
      }
    }
    // Case 2: "this feature" or "current feature"
    else if (/\b(this\s+feature|current\s+feature)\b/i.test(input)) {
      if (options?.activeContextFile) {
        const featureDir = extractFeatureDir(options.activeContextFile);
        extractedScopes.push(featureDir);
      }
    }
    // Case 3: "this folder" or "this directory" or "current directory"
    else if (
      /\b(this\s+folder|this\s+directory|current\s+directory|in\s+this\s+folder)\b/i.test(
        input
      )
    ) {
      if (options?.activeContextFile) {
        const folder = getDirectory(options.activeContextFile);
        extractedScopes.push(folder);
      }
    }
    // Case 4: Named feature or module e.g. "auth feature", "auth module", "the auth module", "checkout feature"
    const featureMatch = input.match(
      /\b(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:feature|module|screen|component)\b/i
    );
    if (
      featureMatch &&
      featureMatch[1] &&
      !["this", "current", "my", "our"].includes(featureMatch[1].toLowerCase())
    ) {
      const featureName = featureMatch[1].toLowerCase();
      extractedScopes.push(`src/features/${featureName}`);
    }

    // Case 5: Direct target after "internationalize" e.g. "Internationalize checkout and..."
    if (extractedScopes.length === 0) {
      const directTargetMatch = input.match(
        /\binternationalize\s+(?:the\s+)?([a-zA-Z0-9_-]+)\b/i
      );
      if (directTargetMatch && directTargetMatch[1]) {
        const target = directTargetMatch[1].toLowerCase();
        const stopWords = [
          "this",
          "current",
          "my",
          "our",
          "the",
          "all",
          "project",
          "app",
          "codebase",
        ];
        if (!stopWords.includes(target)) {
          extractedScopes.push(`src/features/${target}`);
        }
      }
    }

    // Case 6: Explicit paths mentioned in the text (e.g. "src/features/auth", "src/screens/HomeScreen.tsx")
    const pathMatches = input.match(/\b(?:src\/[a-zA-Z0-9_\-\/.]+)\b/g);
    if (pathMatches) {
      for (const p of pathMatches) {
        if (!extractedScopes.includes(p)) {
          extractedScopes.push(p);
        }
      }
    }
  }

  if (extractedScopes.length > 0) {
    result.scope = Array.from(new Set(extractedScopes));
  }

  return result;
}

/**
 * Extracts a feature directory from a file path (e.g. src/features/auth/LoginScreen.tsx -> src/features/auth)
 */
function extractFeatureDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/^(.*\/features\/[^/]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  return getDirectory(normalized);
}

/**
 * Gets directory part of a file path
 */
function getDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash > 0) {
    return normalized.slice(0, lastSlash);
  }
  return normalized;
}
