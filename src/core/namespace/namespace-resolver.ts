import type { I18nMcpConfig } from "../../models/config.js";
import { toPosixPath } from "../../utils/file-system.js";

const COMMON_STRINGS = new Set([
  "save",
  "cancel",
  "close",
  "delete",
  "confirm",
  "continue",
  "back",
  "next",
  "loading",
  "loading...",
  "retry",
  "try again",
  "ok",
  "done",
  "submit",
  "edit",
]);

export function resolveSuggestedNamespace(
  filePath: string,
  text: string,
  knownNamespaces: string[] = ["common"],
  config?: I18nMcpConfig | null
): string {
  const lowerText = text.trim().toLowerCase();

  // 1. If it is a generic common action, prefer "common"
  if (COMMON_STRINGS.has(lowerText) && knownNamespaces.includes("common")) {
    return "common";
  }

  const posixPath = toPosixPath(filePath);

  // 2. Check user configured namespace mappings (e.g. "src/features/auth/**": "auth")
  if (config?.namespaces) {
    for (const [pattern, ns] of Object.entries(config.namespaces)) {
      // Basic match: if pattern ends with /** or /*
      const prefix = pattern.replace(/\/\*\*?$/, "");
      if (posixPath.startsWith(prefix) || posixPath.includes(`/${prefix}/`)) {
        return ns;
      }
    }
  }

  // 3. Extract feature folder conventions:
  // e.g. src/features/<feature>/..., features/<feature>/..., src/screens/<feature>/...
  const featureMatch = posixPath.match(
    /(?:^|\/)(?:features|modules|domains|screens|pages|views)\/([^/]+)/
  );
  if (featureMatch && featureMatch[1]) {
    const candidate = featureMatch[1].toLowerCase();
    // If candidate exists in knownNamespaces, return it
    if (knownNamespaces.includes(candidate)) {
      return candidate;
    }
    // Even if not in knownNamespaces yet, suggest it as the new feature namespace
    return candidate;
  }

  // 4. Shared components folder -> "common"
  if (posixPath.includes("/components/") || posixPath.startsWith("components/")) {
    return "common";
  }

  // 5. Fallback
  return knownNamespaces[0] || "common";
}
