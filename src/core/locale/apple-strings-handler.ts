/**
 * Apple legacy .strings file format handler.
 * Parses and serializes key-value mappings in Localizable.strings format.
 */

export interface AppleStringEntry {
  key: string;
  value: string;
  comment?: string;
}

export function isAppleStringsFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".strings");
}

/**
 * Parses an Apple .strings file into structured entries.
 */
export function parseAppleStrings(content: string): AppleStringEntry[] {
  const entries: AppleStringEntry[] = [];
  const lines = content.split("\n");

  let currentComment: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (!rawLine) continue;

    // Line comment
    if (rawLine.startsWith("//")) {
      currentComment = rawLine.slice(2).trim();
      continue;
    }

    // Block comment
    if (rawLine.startsWith("/*")) {
      let block = rawLine;
      while (!block.includes("*/") && i + 1 < lines.length) {
        i++;
        block += "\n" + lines[i]!;
      }
      currentComment = block
        .replace(/^\/\*\s*/, "")
        .replace(/\s*\*\/$/, "")
        .trim();
      continue;
    }

    // Key-value line: "key" = "value";
    const kvMatch = /^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/.exec(rawLine);
    if (kvMatch) {
      const key = unescapeAppleString(kvMatch[1]!);
      const value = unescapeAppleString(kvMatch[2]!);

      entries.push({
        key,
        value,
        comment: currentComment,
      });

      currentComment = undefined;
    }
  }

  return entries;
}

/**
 * Serializes entries into Apple .strings format.
 */
export function serializeAppleStrings(entries: AppleStringEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.comment) {
      lines.push(`/* ${entry.comment} */`);
    }
    lines.push(`"${escapeAppleString(entry.key)}" = "${escapeAppleString(entry.value)}";`);
    lines.push("");
  }

  return lines.join("\n");
}

function escapeAppleString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function unescapeAppleString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}
