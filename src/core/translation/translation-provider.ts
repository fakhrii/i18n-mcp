export interface TranslationRequest {
  text: string;
  sourceLocale: string;
  targetLocale: string;
  namespace?: string;
  key?: string;
  glossary?: Record<string, string>;
}

export interface TranslationResponse {
  translatedText: string;
  translated: boolean;
  confidence: number;
}

export interface ITranslationProvider {
  translate(req: TranslationRequest): Promise<TranslationResponse>;
}

// Built-in dictionaries for high-frequency terms across common mobile app locales
const BUILTIN_DICTIONARY: Record<string, Record<string, string>> = {
  fr: {
    "welcome back": "Bienvenue",
    "enter your email": "Entrez votre e-mail",
    "enter your password": "Entrez votre mot de passe",
    "manage your personal settings": "Gérer vos paramètres personnels",
    "save": "Enregistrer",
    "cancel": "Annuler",
    "close": "Fermer",
    "delete": "Supprimer",
    "confirm": "Confirmer",
    "continue": "Continuer",
    "back": "Retour",
    "next": "Suivant",
    "loading": "Chargement...",
    "loading...": "Chargement...",
    "retry": "Réessayer",
    "log in": "Se connecter",
    "login": "Se connecter",
    "sign in": "Se connecter",
    "sign out": "Se déconnecter",
    "log out": "Se déconnecter",
    "logout": "Se déconnecter",
    "sign up": "S'inscrire",
    "signup": "S'inscrire",
    "forgot password?": "Mot de passe oublié ?",
    "forgot password": "Mot de passe oublié ?",
    "user profile": "Profil utilisateur",
    "edit profile": "Modifier le profil",
    "profile": "Profil",
    "settings": "Paramètres",
    "home": "Accueil",
    "search": "Rechercher",
    "notifications": "Notifications",
    "ok": "OK",
    "done": "Terminé",
    "submit": "Soumettre",
    "error": "Erreur",
    "success": "Succès",
  },
  es: {
    "welcome back": "Bienvenido de nuevo",
    "enter your email": "Introduce tu correo electrónico",
    "enter your password": "Introduce tu contraseña",
    "manage your personal settings": "Gestiona tus ajustes personales",
    "save": "Guardar",
    "cancel": "Cancelar",
    "close": "Cerrar",
    "delete": "Eliminar",
    "confirm": "Confirmar",
    "continue": "Continuar",
    "back": "Atrás",
    "next": "Siguiente",
    "loading": "Cargando...",
    "loading...": "Cargando...",
    "retry": "Reintentar",
    "log in": "Iniciar sesión",
    "login": "Iniciar sesión",
    "sign in": "Iniciar sesión",
    "sign out": "Cerrar sesión",
    "log out": "Cerrar sesión",
    "logout": "Cerrar sesión",
    "sign up": "Registrarse",
    "signup": "Registrarse",
    "forgot password?": "¿Olvidaste tu contraseña?",
    "forgot password": "¿Olvidaste tu contraseña?",
    "user profile": "Perfil de usuario",
    "edit profile": "Editar perfil",
    "settings": "Ajustes",
    "search": "Buscar",
    "ok": "Aceptar",
    "submit": "Enviar",
  },
};

/**
 * Extracts and preserves interpolation placeholders like {{name}}, {count}, $var.
 */
function extractPlaceholders(text: string): { template: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  let counter = 0;

  // Match {{var}}, {var}, ${var}
  const template = text.replace(/(\{\{[^}]+\}\}|\{[^}]+\}|\$\{[^}]+\})/g, (match) => {
    const placeholderKey = `__PH_${counter++}__`;
    tokens.set(placeholderKey, match);
    return placeholderKey;
  });

  return { template, tokens };
}

/**
 * Restores interpolation placeholders into the translated text.
 */
function restorePlaceholders(text: string, tokens: Map<string, string>): string {
  let result = text;
  for (const [key, original] of tokens.entries()) {
    result = result.replace(new RegExp(key, "g"), () => original);
  }
  return result;
}

/**
 * Default dictionary-based translation provider that respects glossary and preserves placeholders.
 */
export class DictionaryTranslationProvider implements ITranslationProvider {
  async translate(req: TranslationRequest): Promise<TranslationResponse> {
    const { text, targetLocale, glossary } = req;
    const trimmed = text.trim();

    // 1. Check user glossary first
    if (glossary) {
      const lower = trimmed.toLowerCase();
      if (glossary[trimmed]) {
        return { translatedText: glossary[trimmed]!, translated: true, confidence: 1.0 };
      }
      if (glossary[lower]) {
        return { translatedText: glossary[lower]!, translated: true, confidence: 1.0 };
      }
    }

    // 2. Protect placeholders
    const { template, tokens } = extractPlaceholders(trimmed);
    const normalizedKey = template.toLowerCase();

    // 3. Check built-in dictionary
    const langDict = BUILTIN_DICTIONARY[targetLocale.toLowerCase().slice(0, 2)];
    if (langDict) {
      if (langDict[normalizedKey]) {
        const translatedTemplate = langDict[normalizedKey]!;
        return {
          translatedText: restorePlaceholders(translatedTemplate, tokens),
          translated: true,
          confidence: 0.95,
        };
      }

      // Check phrase-level matches in descending order of phrase length
      // e.g. "welcome back" matches before "back"
      const phrases = Object.keys(langDict).sort((a, b) => b.length - a.length);
      let workingTemplate = template;
      let replaced = false;

      for (const phrase of phrases) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const prefix = /^\w/.test(phrase) ? "\\b" : "";
        const suffix = /\w$/.test(phrase) ? "\\b" : "";
        const regex = new RegExp(`${prefix}${escaped}${suffix}`, "gi");

        const replacement = langDict[phrase]!;
        const updated = workingTemplate.replace(regex, () => replacement);
        if (updated !== workingTemplate) {
          workingTemplate = updated;
          replaced = true;
        }
      }

      if (replaced) {
        return {
          translatedText: restorePlaceholders(workingTemplate, tokens),
          translated: true,
          confidence: 0.9,
        };
      }
    }

    // 5. Fallback: preserve original with target locale marker if unknown
    // Returns translated: false to let system know it's pending human review / external translation
    return {
      translatedText: restorePlaceholders(template, tokens),
      translated: false,
      confidence: 0.0,
    };
  }
}
