import type { TranslationExchangeUnit } from "../../models/exchange.js";
import { unescapeXml } from "./xml-utils.js";

export interface ParsedTmx {
  sourceLocale?: string;
  targetLocales: string[];
  units: TranslationExchangeUnit[];
}

function extractAttribute(xml: string, attrName: string): string | undefined {
  const regex = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const match = regex.exec(xml);
  return match ? match[1] : undefined;
}

function extractTagContent(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*|)>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(xml);
  if (!match) return undefined;

  let text = match[1] || "";
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(text);
  if (cdataMatch) {
    return cdataMatch[1];
  }
  return unescapeXml(text.trim());
}

/**
 * Parses a TMX document string into structured translation units.
 */
export function parseTmx(content: string, targetLocaleFilter?: string): ParsedTmx {
  const headerMatch = /<header([^>]*)>/i.exec(content);
  const headerAttrs = headerMatch ? headerMatch[1] || "" : "";
  const sourceLocale = extractAttribute(headerAttrs, "srclang") || "en";

  const targetLocalesSet = new Set<string>();
  const units: TranslationExchangeUnit[] = [];

  const tuRegex = /<tu([^>]*)>([\s\S]*?)<\/tu>/gi;
  let match: RegExpExecArray | null;

  while ((match = tuRegex.exec(content)) !== null) {
    const tuAttrs = match[1] || "";
    const tuBody = match[2] || "";

    const id = extractAttribute(tuAttrs, "tuid");
    if (!id) continue;

    const note = extractTagContent(tuBody, "note");

    let source = "";
    let target: string | undefined;

    const tuvRegex = /<tuv([^>]*)>([\s\S]*?)<\/tuv>/gi;
    let tuvMatch: RegExpExecArray | null;

    while ((tuvMatch = tuvRegex.exec(tuBody)) !== null) {
      const tuvAttrs = tuvMatch[1] || "";
      const tuvBody = tuvMatch[2] || "";

      const lang = extractAttribute(tuvAttrs, "xml:lang") || extractAttribute(tuvAttrs, "lang");
      if (!lang) continue;

      const segText = extractTagContent(tuvBody, "seg") || "";

      if (lang.toLowerCase() === sourceLocale.toLowerCase()) {
        source = segText;
      } else {
        targetLocalesSet.add(lang);
        if (!targetLocaleFilter || lang.toLowerCase() === targetLocaleFilter.toLowerCase()) {
          target = segText;
        }
      }
    }

    units.push({
      id,
      source,
      target,
      note,
      state: target ? "translated" : "needs-translation",
    });
  }

  return {
    sourceLocale,
    targetLocales: Array.from(targetLocalesSet),
    units,
  };
}
