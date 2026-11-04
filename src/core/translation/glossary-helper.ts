import type {
  ITranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "./translation-provider.js";

export interface BrandGlossaryConfig {
  /** Terms and brand names that must NEVER be translated (e.g. ["Antigravity", "Apple Pay", "OAuth"]). */
  neverTranslate?: string[];
  /**
   * Pre-defined mandated term translations.
   * Can be structured as { [term]: { [targetLocale]: translation } }
   * or flat { [term]: translation } (applied to all or default locale).
   */
  terms?: Record<string, Record<string, string> | string>;
  /** Whether term matching is case sensitive (default false). */
  caseSensitive?: boolean;
}

/**
 * Normalizes input glossary config from various formats:
 * - BrandGlossaryConfig object
 * - Record<string, string> (legacy flat dictionary)
 * - Record<string, Record<string, string>>
 */
export function normalizeGlossaryConfig(
  rawGlossary?: BrandGlossaryConfig | Record<string, any>
): BrandGlossaryConfig {
  if (!rawGlossary || typeof rawGlossary !== "object") {
    return {};
  }

  // Already a BrandGlossaryConfig
  if ("neverTranslate" in rawGlossary || "terms" in rawGlossary) {
    return {
      neverTranslate: Array.isArray(rawGlossary.neverTranslate)
        ? rawGlossary.neverTranslate.filter((t: unknown) => typeof t === "string" && t.trim().length > 0)
        : [],
      terms: typeof rawGlossary.terms === "object" ? rawGlossary.terms : {},
      caseSensitive: Boolean(rawGlossary.caseSensitive),
    };
  }

  // Legacy flat dictionary: Record<string, string>
  return {
    neverTranslate: [],
    terms: rawGlossary as Record<string, string>,
    caseSensitive: false,
  };
}

/**
 * Masks never-translate words with unique placeholder tokens.
 */
export function maskNeverTranslateTerms(
  text: string,
  neverTranslate: string[],
  caseSensitive = false
): { maskedText: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  if (!neverTranslate || neverTranslate.length === 0) {
    return { maskedText: text, tokens };
  }

  // Sort by length descending so longer brand names are matched first
  const sortedTerms = [...neverTranslate].sort((a, b) => b.length - a.length);
  let masked = text;
  let counter = 0;

  for (const term of sortedTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = /^\w/.test(term) ? "\\b" : "";
    const suffix = /\w$/.test(term) ? "\\b" : "";
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(`${prefix}${escaped}${suffix}`, flags);

    masked = masked.replace(regex, (match) => {
      const token = `__GLOSSARY_NEVER_${counter++}__`;
      tokens.set(token, match);
      return token;
    });
  }

  return { maskedText: masked, tokens };
}

/**
 * Restores original never-translate words from placeholder tokens.
 */
export function unmaskNeverTranslateTerms(
  text: string,
  tokens: Map<string, string>
): string {
  let result = text;
  for (const [token, original] of tokens.entries()) {
    result = result.replace(new RegExp(token, "g"), () => original);
  }
  return result;
}

/**
 * Resolves a mandated translation for a term and target locale from glossary terms.
 */
export function resolveMandatedTranslation(
  term: string,
  targetLocale: string,
  terms?: Record<string, Record<string, string> | string>,
  caseSensitive = false
): string | undefined {
  if (!terms || typeof terms !== "object") return undefined;

  const targetLang = targetLocale.toLowerCase().slice(0, 2);
  const targetExact = targetLocale.toLowerCase();

  const matchKey = (key: string): boolean => {
    return caseSensitive ? key === term : key.toLowerCase() === term.toLowerCase();
  };

  for (const [key, val] of Object.entries(terms)) {
    if (matchKey(key)) {
      if (typeof val === "string") {
        return val;
      }
      if (typeof val === "object" && val !== null) {
        return val[targetExact] || val[targetLang] || val["*"];
      }
    }
  }

  return undefined;
}

/**
 * Translation Provider Decorator that enforces Brand Glossary rules & Never-Translate safeguards
 * across any underlying provider (OpenAI, Gemini, DeepL, or Dictionary).
 */
export class GlossaryTranslationProvider implements ITranslationProvider {
  constructor(
    private readonly inner: ITranslationProvider,
    private readonly glossaryConfig: BrandGlossaryConfig
  ) {}

  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    const config = normalizeGlossaryConfig(this.glossaryConfig);
    const { text, targetLocale } = req;
    const trimmed = text.trim();

    // 1. Check direct mandated term translation for the full text
    const mandated = resolveMandatedTranslation(
      trimmed,
      targetLocale,
      config.terms,
      config.caseSensitive
    );
    if (mandated !== undefined) {
      return {
        translatedText: mandated,
        translated: true,
        confidence: 1.0,
      };
    }

    // 2. Mask never-translate brand names
    const { maskedText, tokens } = maskNeverTranslateTerms(
      text,
      config.neverTranslate || [],
      config.caseSensitive
    );

    // 3. Delegate to inner provider with masked text
    const response = await this.inner.translate({
      ...req,
      text: maskedText,
    });

    // 4. Unmask never-translate tokens in the response
    const unmaskedText = unmaskNeverTranslateTerms(response.translatedText, tokens);

    return {
      ...response,
      translatedText: unmaskedText,
    };
  }
}
