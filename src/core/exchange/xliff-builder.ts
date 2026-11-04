import type { TranslationExchangeUnit } from "../../models/exchange.js";
import { escapeXml } from "./xml-utils.js";

export interface BuildXliffOptions {
  sourceLocale: string;
  targetLocale: string;
  original?: string;
  units: TranslationExchangeUnit[];
  includeNotes?: boolean;
}

/**
 * Builds an OASIS XLIFF 1.2 XML document string.
 */
export function buildXliff12(options: BuildXliffOptions): string {
  const {
    sourceLocale,
    targetLocale,
    original = "messages.json",
    units,
    includeNotes = true,
  } = options;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">`,
    `  <file original="${escapeXml(original)}" source-language="${escapeXml(sourceLocale)}" target-language="${escapeXml(targetLocale)}" datatype="plaintext">`,
    `    <body>`,
  ];

  for (const unit of units) {
    const stateAttr = unit.state ? ` state="${escapeXml(unit.state)}"` : "";
    lines.push(`      <trans-unit id="${escapeXml(unit.id)}">`);
    lines.push(`        <source>${escapeXml(unit.source)}</source>`);
    if (unit.target !== undefined) {
      lines.push(`        <target${stateAttr}>${escapeXml(unit.target)}</target>`);
    } else {
      lines.push(`        <target state="needs-translation"></target>`);
    }
    if (includeNotes && unit.note) {
      lines.push(`        <note>${escapeXml(unit.note)}</note>`);
    }
    lines.push(`      </trans-unit>`);
  }

  lines.push(`    </body>`, `  </file>`, `</xliff>`, ``);

  return lines.join("\n");
}

/**
 * Builds an OASIS XLIFF 2.0 XML document string.
 */
export function buildXliff20(options: BuildXliffOptions): string {
  const {
    sourceLocale,
    targetLocale,
    original = "f1",
    units,
    includeNotes = true,
  } = options;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="${escapeXml(sourceLocale)}" trgLang="${escapeXml(targetLocale)}">`,
    `  <file id="${escapeXml(original)}">`,
  ];

  for (const unit of units) {
    const stateAttr = unit.state ? ` state="${escapeXml(unit.state)}"` : "";
    lines.push(`    <unit id="${escapeXml(unit.id)}">`);
    if (includeNotes && unit.note) {
      lines.push(`      <notes>`);
      lines.push(`        <note>${escapeXml(unit.note)}</note>`);
      lines.push(`      </notes>`);
    }
    lines.push(`      <segment${stateAttr}>`);
    lines.push(`        <source>${escapeXml(unit.source)}</source>`);
    if (unit.target !== undefined) {
      lines.push(`        <target>${escapeXml(unit.target)}</target>`);
    } else {
      lines.push(`        <target></target>`);
    }
    lines.push(`      </segment>`);
    lines.push(`    </unit>`);
  }

  lines.push(`  </file>`, `</xliff>`, ``);

  return lines.join("\n");
}
