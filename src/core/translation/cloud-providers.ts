import type {
  ITranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from "./translation-provider.js";
import { DictionaryTranslationProvider } from "./translation-provider.js";
import { buildContextPrompt } from "./context-helper.js";
import type { TranslationProviderType } from "../../models/config.js";
import { logger } from "../../utils/logger.js";

export interface CloudProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * DeepL API Translation Provider
 */
export class DeeplTranslationProvider implements ITranslationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: CloudProviderOptions = {}) {
    this.apiKey =
      options.apiKey ||
      process.env.DEEPL_API_KEY ||
      process.env.DEEPL_AUTH_KEY ||
      "";
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.baseUrl = this.apiKey.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    if (!this.isConfigured()) {
      return { translatedText: req.text, translated: false, confidence: 0 };
    }

    const { text, sourceLocale, targetLocale, context } = req;
    let targetLang = targetLocale.toUpperCase().split("-")[0]!;
    if (targetLang === "EN") targetLang = "EN-US";
    if (targetLang === "PT") targetLang = "PT-PT";

    const bodyPayload: Record<string, unknown> = {
      text: [text],
      target_lang: targetLang,
      source_lang: sourceLocale ? sourceLocale.toUpperCase().split("-")[0] : undefined,
    };

    if (context) {
      const contextParts: string[] = [];
      if (context.description) contextParts.push(context.description);
      if (context.role) contextParts.push(`UI role: ${context.role}`);
      if (context.componentName) contextParts.push(`Component: ${context.componentName}`);
      if (context.surroundingText) contextParts.push(`Surrounding text: ${context.surroundingText}`);
      if (contextParts.length > 0) {
        bodyPayload.context = contextParts.join(". ");
      }

      const formalitySupported = [
        "DE", "FR", "IT", "ES", "NL", "PL", "PT", "PT-PT", "PT-BR", "RU", "JA",
      ].includes(targetLang);
      if (formalitySupported && context.formality && context.formality !== "neutral") {
        bodyPayload.formality = context.formality === "formal" ? "more" : "less";
      }
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`DeepL API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { translations?: Array<{ text: string }> };
    if (!data.translations || data.translations.length === 0 || !data.translations[0]?.text) {
      throw new Error("DeepL API returned empty translations");
    }

    return {
      translatedText: data.translations[0].text,
      translated: true,
      confidence: 0.98,
    };
  }
}

/**
 * OpenAI API Translation Provider (gpt-4o-mini default)
 */
export class OpenAiTranslationProvider implements ITranslationProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: CloudProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = options.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.timeoutMs = options.timeoutMs ?? 6000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    if (!this.isConfigured()) {
      return { translatedText: req.text, translated: false, confidence: 0 };
    }

    const { text, sourceLocale, targetLocale, context } = req;
    const contextPrompt = buildContextPrompt(context);
    const systemContent = `You are a professional software localization system. Translate the given UI string from '${sourceLocale}' to '${targetLocale}'. Preserve all variables like {{var}}, {var}, \${var}, and ICU MessageFormat syntax exactly. Output ONLY the translated string without quotes, formatting, or commentary.${
      contextPrompt ? `\n${contextPrompt}` : ""
    }`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: systemContent,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenAI API returned empty response");
    }

    return {
      translatedText: content,
      translated: true,
      confidence: 0.95,
    };
  }
}

/**
 * Google Gemini API Translation Provider (gemini-1.5-flash default)
 */
export class GeminiTranslationProvider implements ITranslationProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: CloudProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options.model || process.env.GEMINI_MODEL || "gemini-1.5-flash";
    this.timeoutMs = options.timeoutMs ?? 6000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    if (!this.isConfigured()) {
      return { translatedText: req.text, translated: false, confidence: 0 };
    }

    const { text, sourceLocale, targetLocale, context } = req;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const contextPrompt = buildContextPrompt(context);

    const prompt = `You are a professional software localization engine. Translate the following software UI text from '${sourceLocale}' to '${targetLocale}'. Preserve all placeholders like {{var}}, {var}, \${var}, and ICU MessageFormat syntax exactly. Return ONLY the translated string with no surrounding quotes or extra commentary:${
      contextPrompt ? `\n${contextPrompt}` : ""
    }\n\n${text}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!candidateText) {
      throw new Error("Gemini API returned empty response");
    }

    return {
      translatedText: candidateText,
      translated: true,
      confidence: 0.95,
    };
  }
}

/**
 * ICU MessageFormat Plural translation helper.
 * Translates each branch (=0{...}, =1{...}, other{...}) individually and reassembles the message.
 */
async function translateIcuPlural(
  icuText: string,
  translateFn: (phrase: string) => Promise<string>
): Promise<string> {
  const headerMatch = icuText.match(/^\{([a-zA-Z0-9_]+),\s*plural\s*,(.*)\}$/s);
  if (!headerMatch || !headerMatch[1] || !headerMatch[2]) {
    return icuText;
  }

  const varName = headerMatch[1];
  const body = headerMatch[2];
  const translatedBranches: string[] = [];

  const selectorRegex = /(=[0-9]+|[a-zA-Z]+)\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = selectorRegex.exec(body)) !== null) {
    const selector = match[1]!;
    const contentStart = match.index + match[0].length;
    let depth = 1;
    let i = contentStart;

    while (i < body.length && depth > 0) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") depth--;
      i++;
    }

    if (depth === 0) {
      const content = body.slice(contentStart, i - 1);
      const translatedContent = await translateFn(content);
      translatedBranches.push(`${selector}{${translatedContent}}`);
      selectorRegex.lastIndex = i;
    }
  }

  if (translatedBranches.length === 0) {
    return icuText;
  }

  return `{${varName}, plural, ${translatedBranches.join(" ")}}`;
}

/**
 * SmartTranslationProvider:
 * Wraps optional cloud provider with automatic, non-blocking fallback to DictionaryTranslationProvider.
 * If cloud provider is not configured or fails, dictionary translation executes seamlessly.
 */
export class SmartTranslationProvider implements ITranslationProvider {
  private readonly cloudProvider: ITranslationProvider | null;
  private readonly fallbackProvider: ITranslationProvider;

  constructor(
    cloudProvider: ITranslationProvider | null = null,
    fallbackProvider: ITranslationProvider = new DictionaryTranslationProvider()
  ) {
    this.cloudProvider = cloudProvider;
    this.fallbackProvider = fallbackProvider;
  }

  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    const { text, glossary } = req;
    const trimmed = text.trim();

    // 1. User Glossary has highest priority
    if (glossary) {
      const lower = trimmed.toLowerCase();
      if (glossary[trimmed]) {
        return { translatedText: glossary[trimmed]!, translated: true, confidence: 1.0 };
      }
      if (glossary[lower]) {
        return { translatedText: glossary[lower]!, translated: true, confidence: 1.0 };
      }
    }

    // 2. Handle ICU Plurals
    if (/^\{[a-zA-Z0-9_]+,\s*plural\s*,/i.test(trimmed)) {
      try {
        const icuResult = await translateIcuPlural(trimmed, async (branchText) => {
          const res = await this.translate({ ...req, text: branchText });
          return res.translatedText;
        });
        return {
          translatedText: icuResult,
          translated: true,
          confidence: 0.9,
        };
      } catch (err: unknown) {
        logger.warn(`ICU plural translation failed: ${String(err)}`);
      }
    }

    // 3. Try Cloud Provider if available (non-blocking)
    if (this.cloudProvider) {
      try {
        const cloudRes = await this.cloudProvider.translate(req);
        if (cloudRes.translated) {
          return cloudRes;
        }
      } catch (err: unknown) {
        logger.warn(
          `Optional cloud translation provider error: ${err instanceof Error ? err.message : String(err)}. Falling back to local dictionary.`
        );
      }
    }

    // 4. Safe Local Dictionary Fallback
    return this.fallbackProvider.translate(req);
  }
}

/**
 * Factory for creating an ITranslationProvider according to configuration,
 * guaranteeing optional, non-blocking operation with offline dictionary fallback.
 */
export function createTranslationProvider(options: {
  provider?: TranslationProviderType;
  apiKey?: string;
  model?: string;
} = {}): ITranslationProvider {
  const chosenProvider = options.provider || "auto";

  let cloudProvider: ITranslationProvider | null = null;

  if (chosenProvider === "deepl") {
    cloudProvider = new DeeplTranslationProvider({ apiKey: options.apiKey });
  } else if (chosenProvider === "openai") {
    cloudProvider = new OpenAiTranslationProvider({ apiKey: options.apiKey, model: options.model });
  } else if (chosenProvider === "gemini") {
    cloudProvider = new GeminiTranslationProvider({ apiKey: options.apiKey, model: options.model });
  } else if (chosenProvider === "auto") {
    const key = options.apiKey?.trim();

    // 1. Inspect passed apiKey signature if provided
    if (key) {
      if (key.startsWith("sk-")) {
        cloudProvider = new OpenAiTranslationProvider({ apiKey: key, model: options.model });
      } else if (key.startsWith("AIza")) {
        cloudProvider = new GeminiTranslationProvider({ apiKey: key, model: options.model });
      } else if (key.endsWith(":fx") || (key.length === 36 && key.includes("-"))) {
        cloudProvider = new DeeplTranslationProvider({ apiKey: key });
      } else if (options.model?.toLowerCase().includes("gpt")) {
        cloudProvider = new OpenAiTranslationProvider({ apiKey: key, model: options.model });
      } else if (options.model?.toLowerCase().includes("gemini")) {
        cloudProvider = new GeminiTranslationProvider({ apiKey: key, model: options.model });
      } else {
        // Default to OpenAI when generic API key is supplied
        cloudProvider = new OpenAiTranslationProvider({ apiKey: key, model: options.model });
      }
    }

    // 2. If no cloudProvider matched yet, check environment variables
    if (!cloudProvider) {
      if (process.env.DEEPL_API_KEY || process.env.DEEPL_AUTH_KEY) {
        cloudProvider = new DeeplTranslationProvider({ apiKey: options.apiKey });
      } else if (process.env.GEMINI_API_KEY) {
        cloudProvider = new GeminiTranslationProvider({ apiKey: options.apiKey, model: options.model });
      } else if (process.env.OPENAI_API_KEY) {
        cloudProvider = new OpenAiTranslationProvider({ apiKey: options.apiKey, model: options.model });
      }
    }
  }

  // Wrap in SmartTranslationProvider so dictionary fallback is always active and non-blocking
  return new SmartTranslationProvider(cloudProvider, new DictionaryTranslationProvider());
}
