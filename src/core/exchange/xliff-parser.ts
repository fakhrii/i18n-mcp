import type {
  TranslationExchangeUnit,
  TranslationUnitState,
} from "../../models/exchange.js";
import { unescapeXml } from "./xml-utils.js";

export interface ParsedXliff {
  version: "1.2" | "2.0";
  sourceLocale?: string;
  targetLocale?: string;
  original?: string;
  units: TranslationExchangeUnit[];
}

function extractTagContent(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*|)>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(xml);
  if (!match) return undefined;

  let text = match[1] || "";
  // Handle CDATA if present
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(text);
  if (cdataMatch) {
    return cdataMatch[1];
  }
  return unescapeXml(text.trim());
}

function extractAttribute(xml: string, attrName: string): string | undefined {
  const regex = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const match = regex.exec(xml);
  return match ? match[1] : undefined;
}

/**
 * Parses an XLIFF document string (supports 1.2 and 2.0).
 */
export function parseXliff(content: string): ParsedXliff {
  const isV2 = /<xliff[^>]+version=["']2\./i.test(content);

  if (isV2) {
    return parseXliff20(content);
  } else {
    return parseXliff12(content);
  }
}

function parseXliff12(content: string): ParsedXliff {
  const fileTagMatch = /<file([^>]*)>/i.exec(content);
  const fileAttrs = fileTagMatch ? fileTagMatch[1] || "" : "";

  const sourceLocale = extractAttribute(fileAttrs, "source-language");
  const targetLocale = extractAttribute(fileAttrs, "target-language");
  const original = extractAttribute(fileAttrs, "original");

  const units: TranslationExchangeUnit[] = [];

  const transUnitRegex = /<trans-unit([^>]*)>([\s\S]*?)<\/trans-unit>/gi;
  let match: RegExpExecArray | null;

  while ((match = transUnitRegex.exec(content)) !== null) {
    const tuAttrs = match[1] || "";
    const tuBody = match[2] || "";

    const id = extractAttribute(tuAttrs, "id");
    if (!id) continue;

    const source = extractTagContent(tuBody, "source") || "";
    const target = extractTagContent(tuBody, "target");
    const note = extractTagContent(tuBody, "note");

    let state: TranslationUnitState | undefined;
    const targetTagMatch = /<target([^>]*)>/i.exec(tuBody);
    if (targetTagMatch) {
      const stateAttr = extractAttribute(targetTagMatch[1] || "", "state");
      if (stateAttr) {
        state = stateAttr as TranslationUnitState;
      }
    }

    units.push({
      id,
      source,
      target,
      note,
      state,
    });
  }

  return {
    version: "1.2",
    sourceLocale,
    targetLocale,
    original,
    units,
  };
}

function parseXliff20(content: string): ParsedXliff {
  const xliffTagMatch = /<xliff([^>]*)>/i.exec(content);
  const xliffAttrs = xliffTagMatch ? xliffTagMatch[1] || "" : "";

  const sourceLocale = extractAttribute(xliffAttrs, "srcLang");
  const targetLocale = extractAttribute(xliffAttrs, "trgLang");

  const fileTagMatch = /<file([^>]*)>/i.exec(content);
  const original = fileTagMatch ? extractAttribute(fileTagMatch[1] || "", "id") : undefined;

  const units: TranslationExchangeUnit[] = [];

  const unitRegex = /<unit([^>]*)>([\s\S]*?)<\/unit>/gi;
  let match: RegExpExecArray | null;

  while ((match = unitRegex.exec(content)) !== null) {
    const unitAttrs = match[1] || "";
    const unitBody = match[2] || "";

    const id = extractAttribute(unitAttrs, "id");
    if (!id) continue;

    const source = extractTagContent(unitBody, "source") || "";
    const target = extractTagContent(unitBody, "target");
    const note = extractTagContent(unitBody, "note");

    let state: TranslationUnitState | undefined;
    const segmentTagMatch = /<segment([^>]*)>/i.exec(unitBody);
    if (segmentTagMatch) {
      const stateAttr = extractAttribute(segmentTagMatch[1] || "", "state");
      if (stateAttr) {
        state = stateAttr as TranslationUnitState;
      }
    }

    units.push({
      id,
      source,
      target,
      note,
      state,
    });
  }

  return {
    version: "2.0",
    sourceLocale,
    targetLocale,
    original,
    units,
  };
}
