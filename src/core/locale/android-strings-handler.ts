/**
 * Android XML Resources (strings.xml) Handler.
 * Parses, queries, updates, and serializes Android string and plurals catalogs.
 */

import { unescapeXml } from "../exchange/xml-utils.js";

export interface AndroidStringEntry {
  name: string;
  value: string;
  comment?: string;
  translatable?: boolean;
}

export interface AndroidPluralEntry {
  name: string;
  items: Record<string, string>; // quantity -> value (zero, one, two, few, many, other)
  comment?: string;
}

export interface AndroidCatalog {
  strings: Map<string, AndroidStringEntry>;
  plurals: Map<string, AndroidPluralEntry>;
}

export function isAndroidStringsFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  return (norm.includes("res/values") || norm.includes("/values")) && norm.endsWith("strings.xml");
}

function unescapeAndroidString(str: string): string {
  if (!str) return "";
  let clean = str
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  clean = unescapeXml(clean);
  // Trim enclosing quotes if present (e.g. "  text  ")
  if (clean.startsWith('"') && clean.endsWith('"') && clean.length >= 2) {
    clean = clean.slice(1, -1);
  }
  return clean;
}

function escapeAndroidString(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

/**
 * Parses an Android strings.xml XML string into an AndroidCatalog.
 */
export function parseAndroidStrings(xml: string): AndroidCatalog {
  const strings = new Map<string, AndroidStringEntry>();
  const plurals = new Map<string, AndroidPluralEntry>();

  // Extract <string name="...">...</string>
  const stringRegex = /<string\s+name=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/string>/gi;
  let match: RegExpExecArray | null;

  while ((match = stringRegex.exec(xml)) !== null) {
    const matchIndex = match.index;
    const name = match[1]!;
    const attrs = match[2] || "";
    const rawVal = match[3] || "";

    // Check if there is a comment immediately preceding this tag (with only whitespace in-between)
    let comment: string | undefined;
    const preText = xml.slice(0, matchIndex);
    const commentMatch = /<!--([\s\S]*?)-->\s*$/.exec(preText);
    if (commentMatch && !commentMatch[1]!.includes("<string") && !commentMatch[1]!.includes("<plurals")) {
      comment = commentMatch[1]!.trim();
    }

    const translatable = !attrs.includes('translatable="false"');
    const value = unescapeAndroidString(rawVal);

    strings.set(name, {
      name,
      value,
      comment,
      translatable,
    });
  }

  // Extract <plurals name="...">...</plurals>
  const pluralsRegex = /<plurals\s+name=["']([^"']+)["']>([\s\S]*?)<\/plurals>/gi;
  while ((match = pluralsRegex.exec(xml)) !== null) {
    const matchIndex = match.index;
    const name = match[1]!;
    const body = match[2] || "";

    let comment: string | undefined;
    const preText = xml.slice(0, matchIndex);
    const commentMatch = /<!--([\s\S]*?)-->\s*$/.exec(preText);
    if (commentMatch && !commentMatch[1]!.includes("<string") && !commentMatch[1]!.includes("<plurals")) {
      comment = commentMatch[1]!.trim();
    }

    const items: Record<string, string> = {};
    const itemRegex = /<item\s+quantity=["']([^"']+)["']>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(body)) !== null) {
      const quantity = itemMatch[1]!;
      const itemVal = unescapeAndroidString(itemMatch[2] || "");
      items[quantity] = itemVal;
    }

    plurals.set(name, {
      name,
      items,
      comment,
    });
  }

  return { strings, plurals };
}

/**
 * Serializes an AndroidCatalog into a formatted Android strings.xml XML document.
 */
export function serializeAndroidStrings(catalog: AndroidCatalog): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<resources>`,
  ];

  for (const entry of catalog.strings.values()) {
    if (entry.comment) {
      lines.push(`    <!-- ${entry.comment} -->`);
    }
    const translatableAttr = entry.translatable === false ? ' translatable="false"' : "";
    lines.push(`    <string name="${entry.name}"${translatableAttr}>${escapeAndroidString(entry.value)}</string>`);
  }

  for (const plural of catalog.plurals.values()) {
    if (plural.comment) {
      lines.push(`    <!-- ${plural.comment} -->`);
    }
    lines.push(`    <plurals name="${plural.name}">`);
    for (const [quantity, val] of Object.entries(plural.items)) {
      lines.push(`        <item quantity="${quantity}">${escapeAndroidString(val)}</item>`);
    }
    lines.push(`    </plurals>`);
  }

  lines.push(`</resources>`, ``);
  return lines.join("\n");
}
