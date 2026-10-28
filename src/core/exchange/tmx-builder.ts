import type { TranslationExchangeUnit } from "../../models/exchange.js";
import { escapeXml } from "./xml-utils.js";

export interface BuildTmxOptions {
  sourceLocale: string;
  targetLocale?: string;
  units: TranslationExchangeUnit[];
  includeNotes?: boolean;
}

/**
 * Builds a LISA OSCAR TMX 1.4 XML document string.
 */
export function buildTmx14(options: BuildTmxOptions): string {
  const {
    sourceLocale,
    targetLocale,
    units,
    includeNotes = true,
  } = options;

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE tmx SYSTEM "tmx14.dtd">`,
    `<tmx version="1.4">`,
    `  <header creationtool="i18n-mcp" creationtoolversion="0.1.4" datatype="PlainText" segtype="sentence" adminlang="en" srclang="${escapeXml(sourceLocale)}" o-tmf="UTF-8"/>`,
    `  <body>`,
  ];

  for (const unit of units) {
    lines.push(`    <tu tuid="${escapeXml(unit.id)}">`);
    if (includeNotes && unit.note) {
      lines.push(`      <note>${escapeXml(unit.note)}</note>`);
    }
    lines.push(`      <tuv xml:lang="${escapeXml(sourceLocale)}">`);
    lines.push(`        <seg>${escapeXml(unit.source)}</seg>`);
    lines.push(`      </tuv>`);

    if (unit.target !== undefined && targetLocale) {
      lines.push(`      <tuv xml:lang="${escapeXml(targetLocale)}">`);
      lines.push(`        <seg>${escapeXml(unit.target)}</seg>`);
      lines.push(`      </tuv>`);
    }

    lines.push(`    </tu>`);
  }

  lines.push(`  </body>`, `</tmx>`, ``);

  return lines.join("\n");
}
