export type KeyNamingStyle =
  | "UPPER_SNAKE_CASE"
  | "lowerCamelCase"
  | "camelCase"
  | "snake_case"
  | "kebab-case";

/**
 * Common action and concept phrases mapped to standard canonical English keys.
 * All keys stored in normalized form (lowercase, no diacritics, trimmed, single-spaced).
 */
const COMMON_ACTION_MAP: Record<string, string> = {
  // English
  save: "SAVE",
  cancel: "CANCEL",
  close: "CLOSE",
  delete: "DELETE",
  confirm: "CONFIRM",
  continue: "CONTINUE",
  back: "BACK",
  next: "NEXT",
  previous: "PREVIOUS",
  loading: "LOADING",
  "loading...": "LOADING",
  retry: "RETRY",
  "try again": "TRY_AGAIN",
  "try again later": "TRY_AGAIN_LATER",
  "log in": "LOGIN",
  login: "LOGIN",
  "sign in": "SIGN_IN",
  signin: "SIGN_IN",
  "sign up": "SIGN_UP",
  signup: "SIGN_UP",
  "log out": "LOGOUT",
  logout: "LOGOUT",
  "sign out": "SIGN_OUT",
  signout: "SIGN_OUT",
  ok: "OK",
  done: "DONE",
  submit: "SUBMIT",
  edit: "EDIT",
  search: "SEARCH",
  "view all": "VIEW_ALL",
  "see all": "SEE_ALL",
  "forgot password": "FORGOT_PASSWORD",
  "forgot password?": "FORGOT_PASSWORD",
  "welcome back": "WELCOME_BACK",
  welcome: "WELCOME",
  "about us": "ABOUT_US",
  "new year": "NEW_YEAR",
  "create account": "CREATE_ACCOUNT",
  "edit profile": "EDIT_PROFILE",
  "save changes": "SAVE_CHANGES",
  "terms of use": "TERMS_OF_USE",
  "privacy policy": "PRIVACY_POLICY",
  "user profile": "USER_PROFILE",
  settings: "SETTINGS",
  help: "HELP",
  contact: "CONTACT",

  // French (normalized)
  "creer un compte": "CREATE_ACCOUNT",
  "creer un profil": "CREATE_ACCOUNT",
  "creer compte": "CREATE_ACCOUNT",
  "se connecter": "LOGIN",
  connexion: "LOGIN",
  "se deconnecter": "LOGOUT",
  deconnexion: "LOGOUT",
  "s inscrire": "SIGN_UP",
  inscription: "SIGN_UP",
  "mot de passe oublie": "FORGOT_PASSWORD",
  "mot de passe oublie ?": "FORGOT_PASSWORD",
  "enregistrer les modifications": "SAVE_CHANGES",
  "sauvegarder les modifications": "SAVE_CHANGES",
  enregistrer: "SAVE",
  sauvegarder: "SAVE",
  annuler: "CANCEL",
  fermer: "CLOSE",
  supprimer: "DELETE",
  confirmer: "CONFIRM",
  continuer: "CONTINUE",
  suivant: "NEXT",
  suivante: "NEXT",
  precedent: "PREVIOUS",
  precedente: "PREVIOUS",
  retour: "BACK",
  accueil: "HOME",
  parametres: "SETTINGS",
  profil: "PROFILE",
  "modifier le profil": "EDIT_PROFILE",
  "modifier profil": "EDIT_PROFILE",
  modifier: "EDIT",
  rechercher: "SEARCH",
  recherche: "SEARCH",
  chargement: "LOADING",
  "chargement...": "LOADING",
  reessayer: "RETRY",
  envoyer: "SUBMIT",
  soumettre: "SUBMIT",
  termine: "DONE",
  erreur: "ERROR",
  succes: "SUCCESS",
  bienvenue: "WELCOME",
  "bienvenue de nouveau": "WELCOME_BACK",
  "a propos": "ABOUT_US",
  "a propos de nous": "ABOUT_US",
  "nouvel an": "NEW_YEAR",
  "bonne annee": "NEW_YEAR",
  aide: "HELP",
  panier: "CART",
  commander: "ORDER",
  "passer la commande": "PLACE_ORDER",
  "termes et conditions": "TERMS_OF_USE",
  "conditions d utilisation": "TERMS_OF_USE",
  "politique de confidentialite": "PRIVACY_POLICY",

  // Spanish (normalized)
  "crear cuenta": "CREATE_ACCOUNT",
  "crear una cuenta": "CREATE_ACCOUNT",
  "crear un perfil": "CREATE_ACCOUNT",
  "iniciar sesion": "LOGIN",
  "cerrar sesion": "LOGOUT",
  registrarse: "SIGN_UP",
  registro: "SIGN_UP",
  "olvidaste tu contrasena": "FORGOT_PASSWORD",
  "olvidaste tu contrasena?": "FORGOT_PASSWORD",
  "has olvidado tu contrasena": "FORGOT_PASSWORD",
  "guardar cambios": "SAVE_CHANGES",
  guardar: "SAVE",
  cancelar: "CANCEL",
  cerrar: "CLOSE",
  eliminar: "DELETE",
  borrar: "DELETE",
  confirmar: "CONFIRM",
  continuar: "CONTINUE",
  siguiente: "NEXT",
  anterior: "PREVIOUS",
  atras: "BACK",
  inicio: "HOME",
  ajustes: "SETTINGS",
  configuracion: "SETTINGS",
  perfil: "PROFILE",
  "editar perfil": "EDIT_PROFILE",
  editar: "EDIT",
  buscar: "SEARCH",
  busqueda: "SEARCH",
  cargando: "LOADING",
  "cargando...": "LOADING",
  reintentar: "RETRY",
  enviar: "SUBMIT",
  listo: "DONE",
  exito: "SUCCESS",
  bienvenido: "WELCOME",
  bienvenida: "WELCOME",
  "bienvenido de nuevo": "WELCOME_BACK",
  "sobre nosotros": "ABOUT_US",
  "acerca de nosotros": "ABOUT_US",
  "ano nuevo": "NEW_YEAR",
  "feliz ano nuevo": "NEW_YEAR",
  ayuda: "HELP",
  contacto: "CONTACT",
  carrito: "CART",
  "realizar pedido": "PLACE_ORDER",
  "terminos de uso": "TERMS_OF_USE",
  "politica de privacidad": "PRIVACY_POLICY",

  // German (normalized)
  "konto erstellen": "CREATE_ACCOUNT",
  "benutzerkonto erstellen": "CREATE_ACCOUNT",
  anmelden: "LOGIN",
  einloggen: "LOGIN",
  abmelden: "LOGOUT",
  ausloggen: "LOGOUT",
  registrieren: "SIGN_UP",
  registrierung: "SIGN_UP",
  "passwort vergessen": "FORGOT_PASSWORD",
  "passwort vergessen?": "FORGOT_PASSWORD",
  "anderungen speichern": "SAVE_CHANGES",
  speichern: "SAVE",
  abbrechen: "CANCEL",
  schliessen: "CLOSE",
  loschen: "DELETE",
  bestatigen: "CONFIRM",
  weiter: "CONTINUE",
  zuruck: "BACK",
  startseite: "HOME",
  einstellungen: "SETTINGS",
  "profil bearbeiten": "EDIT_PROFILE",
  bearbeiten: "EDIT",
  suchen: "SEARCH",
  suche: "SEARCH",
  "laden...": "LOADING",
  "erneut versuchen": "RETRY",
  absenden: "SUBMIT",
  senden: "SUBMIT",
  fertig: "DONE",
  fehler: "ERROR",
  erfolg: "SUCCESS",
  willkommen: "WELCOME",
  "willkommen zuruck": "WELCOME_BACK",
  "uber uns": "ABOUT_US",
  "neues jahr": "NEW_YEAR",
  "frohes neues jahr": "NEW_YEAR",
  hilfe: "HELP",
  kontakt: "CONTACT",
  warenkorb: "CART",
  bestellen: "ORDER",
  nutzungsbedingungen: "TERMS_OF_USE",
  datenschutzrichtlinie: "PRIVACY_POLICY",

  // Italian & Portuguese (normalized)
  "crea account": "CREATE_ACCOUNT",
  "criar conta": "CREATE_ACCOUNT",
  accedi: "LOGIN",
  entrar: "LOGIN",
  esci: "LOGOUT",
  sair: "LOGOUT",
  "password dimenticata": "FORGOT_PASSWORD",
  "esqueci minha senha": "FORGOT_PASSWORD",
  salva: "SAVE",
  salvar: "SAVE",
  "salva modifiche": "SAVE_CHANGES",
  "salvar alteracoes": "SAVE_CHANGES",
  chiudi: "CLOSE",
  fechar: "CLOSE",
  annulla: "CANCEL",
  elimina: "DELETE",
  excluir: "DELETE",
  conferma: "CONFIRM",
  continua: "CONTINUE",
  avanti: "NEXT",
  indietro: "BACK",
  voltar: "BACK",
  "chi siamo": "ABOUT_US",
  "quem somos": "ABOUT_US",
};

/**
 * Word-level lemma translation to English for common Latin-based UI terms.
 * All keys stored in normalized lowercase form without diacritics.
 */
const WORD_TRANSLATION_MAP: Record<string, string> = {
  // Nouns
  compte: "account",
  cuenta: "account",
  konto: "account",
  utilisateur: "user",
  usuario: "user",
  benutzer: "user",
  utente: "user",
  nom: "name",
  nombre: "name",
  cognome: "name",
  prenom: "first_name",
  apellido: "last_name",
  vorname: "first_name",
  nachname: "last_name",
  adresse: "address",
  direccion: "address",
  indirizzo: "address",
  anschrift: "address",
  courriel: "email",
  correo: "email",
  telephone: "phone",
  telefono: "phone",
  date: "date",
  fecha: "date",
  datum: "date",
  heure: "time",
  hora: "time",
  zeit: "time",
  jour: "day",
  dia: "day",
  tag: "day",
  mois: "month",
  mes: "month",
  monat: "month",
  annee: "year",
  ano: "year",
  jahr: "year",
  pays: "country",
  pais: "country",
  land: "country",
  ville: "city",
  ciudad: "city",
  stadt: "city",
  produit: "product",
  producto: "product",
  produkt: "product",
  article: "item",
  articulo: "item",
  artikel: "item",
  panier: "cart",
  carrito: "cart",
  warenkorb: "cart",
  commande: "order",
  pedido: "order",
  bestellung: "order",
  livraison: "delivery",
  envio: "shipping",
  lieferung: "delivery",
  paiement: "payment",
  pago: "payment",
  zahlung: "payment",
  prix: "price",
  precio: "price",
  preis: "price",
  total: "total",
  gesamt: "total",
  message: "message",
  mensaje: "message",
  nachricht: "message",
  detail: "detail",
  details: "details",
  detalles: "details",
  titre: "title",
  titulo: "title",
  titel: "title",
  description: "description",
  descripcion: "description",
  beschreibung: "description",
  image: "image",
  foto: "photo",
  bild: "image",
  fichier: "file",
  archivo: "file",
  datei: "file",
  page: "page",
  pagina: "page",
  seite: "page",
  bouton: "button",
  boton: "button",
  taste: "button",
  texte: "text",
  texto: "text",
  liste: "list",
  lista: "list",
  carte: "card",
  tarjeta: "card",
  karte: "card",
  historique: "history",
  historial: "history",
  verlauf: "history",
  statut: "status",
  estado: "status",
  options: "options",
  opciones: "options",
  optionen: "options",
  parametres: "settings",
  ajustes: "settings",
  einstellungen: "settings",
  profil: "profile",
  perfil: "profile",
  motdepasse: "password",
  contrasena: "password",
  passwort: "password",
  erreur: "error",
  fehler: "error",
  succes: "success",
  exito: "success",
  erfolg: "success",
  aide: "help",
  ayuda: "help",
  hilfe: "help",
  contact: "contact",
  contacto: "contact",
  kontakt: "contact",

  // Verbs
  creer: "create",
  crear: "create",
  erstellen: "create",
  ajouter: "add",
  anadir: "add",
  agregar: "add",
  hinzufugen: "add",
  hinzufuegen: "add",
  supprimer: "delete",
  eliminar: "delete",
  borrar: "delete",
  loschen: "delete",
  loeschen: "delete",
  modifier: "edit",
  editar: "edit",
  bearbeiten: "edit",
  actualiser: "update",
  actualizar: "update",
  aktualisieren: "update",
  enregistrer: "save",
  sauvegarder: "save",
  guardar: "save",
  speichern: "save",
  annuler: "cancel",
  cancelar: "cancel",
  abbrechen: "cancel",
  confirmer: "confirm",
  confirmar: "confirm",
  bestatigen: "confirm",
  bestaetigen: "confirm",
  envoyer: "send",
  enviar: "send",
  senden: "send",
  telecharger: "download",
  descargar: "download",
  herunterladen: "download",
  partager: "share",
  compartir: "share",
  teilen: "share",
  copier: "copy",
  copiar: "copy",
  kopieren: "copy",
  rechercher: "search",
  buscar: "search",
  suchen: "search",
  choisir: "select",
  selectionner: "select",
  elegir: "select",
  seleccionar: "select",
  wahlen: "select",
  waehlen: "select",
  ouvrir: "open",
  abrir: "open",
  offnen: "open",
  oeffnen: "open",
  fermer: "close",
  cerrar: "close",
  schliessen: "close",
  voir: "view",
  afficher: "show",
  ver: "view",
  mostrar: "show",
  anzeigen: "view",
  payer: "pay",
  pagar: "pay",
  bezahlen: "pay",
  commander: "order",
  bestellen: "order",

  // Adjectives
  nouveau: "new",
  nouvelle: "new",
  nouveaux: "new",
  nouvelles: "new",
  nuevo: "new",
  nueva: "new",
  nuevos: "new",
  nuevas: "new",
  neu: "new",
  neue: "new",
  neues: "new",
  nuovo: "new",
  nuova: "new",
  ancien: "old",
  ancienne: "old",
  antiguo: "old",
  antigua: "old",
  alt: "old",
  premier: "first",
  premiere: "first",
  primero: "first",
  primera: "first",
  erste: "first",
  erster: "first",
  dernier: "last",
  derniere: "last",
  ultimo: "last",
  ultima: "last",
  letzte: "last",
  letzter: "last",
  suivant: "next",
  suivante: "next",
  siguiente: "next",
  nachste: "next",
  naechste: "next",
  precedent: "previous",
  precedente: "previous",
  anterior: "previous",
  vorherige: "previous",
  gratuit: "free",
  gratuite: "free",
  gratis: "free",
  kostenlos: "free",
  personnel: "personal",
  personnelle: "personal",
  personal: "personal",
};

/**
 * Non-English stop-words (articles, prepositions, conjunctions) across French, Spanish, German, Italian, Portuguese.
 */
const FOREIGN_STOP_WORDS = new Set([
  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "et", "ou", "en", "dans", "sur",
  "pour", "avec", "est", "sont", "votre", "vos", "notre", "nos", "mon", "ma", "mes", "ton",
  "ta", "tes", "son", "sa", "ses", "leur", "leurs", "ce", "cet", "cette", "ces", "par", "au", "aux",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "del", "de", "y", "e", "o", "u",
  "en", "sobre", "para", "por", "con", "sin", "es", "son", "su", "sus", "tu", "tus", "mi",
  "mis", "nuestro", "nuestra", "nuestros", "nuestas", "este", "esta", "estos", "estas", "al",
  // German
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einem", "einen",
  "und", "oder", "in", "auf", "zu", "zum", "zur", "fur", "fuer", "mit", "von", "vom", "ist",
  "sind", "war", "ihr", "ihre", "dein", "deine", "mein", "meine", "unser", "unsere", "dieses",
  "diese", "dieser", "nicht", "im", "am", "an",
  // Italian & Portuguese
  "il", "lo", "i", "gli", "dello", "della", "dei", "degli", "delle", "tra", "fra", "tuo", "tua",
  "tuoi", "tue", "mio", "mia", "miei", "mie", "questo", "questa", "questi", "queste", "allo",
  "alla", "ai", "agli", "alle", "da", "os", "as", "umas", "dos", "das", "no", "na", "nos",
  "nas", "sem", "sao", "seu", "sua", "seus", "suas", "teu", "teus", "nosso", "nossa", "nossos", "nossas", "ao", "aos",
]);

/**
 * Generic identifiers in contextPrefix that shouldn't be used as standalone semantic keys.
 */
const GENERIC_CONTEXT_WORDS = new Set([
  "text", "label", "title", "content", "value", "string", "item", "element", "component",
  "button", "btn", "view", "box", "container", "screen", "page",
]);

/**
 * Detects whether a string is likely written in a non-English language (Latin or accented).
 */
export function isLikelyNonEnglish(rawText: string): boolean {
  // 1. Accented characters / diacritics in Latin text (virtually non-existent in English UI)
  if (/[\u00C0-\u024F\u1E00-\u1EFF]/.test(rawText)) {
    return true;
  }

  // 2. Normalized check for non-English words
  const normalized = rawText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  let foreignHits = 0;
  for (const w of words) {
    if (FOREIGN_STOP_WORDS.has(w) || WORD_TRANSLATION_MAP[w]) {
      foreignHits++;
    }
  }

  return foreignHits > 0 && foreignHits >= Math.ceil(words.length * 0.4);
}

/**
 * Extracts and splits camelCase, snake_case, or kebab-case contextPrefix into words.
 */
function extractContextWords(contextPrefix: string): string[] {
  return contextPrefix
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function formatKeyByStyle(words: string[], style: KeyNamingStyle = "UPPER_SNAKE_CASE"): string {
  if (words.length === 0) return "KEY";

  switch (style) {
    case "lowerCamelCase":
    case "camelCase": {
      const first = words[0]!.toLowerCase();
      const rest = words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      return first + rest.join("");
    }
    case "snake_case":
      return words.map((w) => w.toLowerCase()).join("_");
    case "kebab-case":
      return words.map((w) => w.toLowerCase()).join("-");
    case "UPPER_SNAKE_CASE":
    default:
      return words.map((w) => w.toUpperCase()).join("_");
  }
}

/**
 * Generates an idiomatic English semantic translation key for any source text,
 * guaranteeing English keys even when the source text is in French, Spanish, German, etc.
 */
export function generateSemanticKey(
  text: string,
  contextPrefix?: string,
  keyStyle: KeyNamingStyle = "UPPER_SNAKE_CASE"
): string {
  const trimmed = text.trim();

  // Strip interpolation patterns e.g. {{name}} or ${name} or <tags>
  const cleanInterpolations = trimmed
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

  // Normalized key for direct phrase lookup: lowercase, accents stripped, punctuation removed
  const normalizedKey = cleanInterpolations
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Direct Multi-Language Concept Match (covers French, Spanish, German, Italian, English)
  if (COMMON_ACTION_MAP[normalizedKey]) {
    const actionKey = COMMON_ACTION_MAP[normalizedKey]!;
    return formatKeyByStyle(actionKey.split("_"), keyStyle);
  }

  // 2. Non-Latin script handling (Arabic, CJK, Cyrillic, etc.)
  const latinClean = normalizedKey.replace(/[^a-z0-9\s]/g, "").trim();
  if (!latinClean) {
    if (contextPrefix) {
      const prefixWords = extractContextWords(contextPrefix);
      if (prefixWords.length > 1 || (prefixWords.length === 1 && prefixWords[0]!.length > 4)) {
        return formatKeyByStyle(prefixWords, keyStyle);
      }
      return formatKeyByStyle([...prefixWords, "TEXT"], keyStyle);
    }
    return formatKeyByStyle(["TEXT"], keyStyle);
  }

  // 3. Non-English Latin detection & translation
  const isForeign = isLikelyNonEnglish(trimmed);

  if (isForeign) {
    // A. Check context-first: if the developer gave an informative English prop/variable name
    if (contextPrefix) {
      const prefixWords = extractContextWords(contextPrefix);
      const informativePrefixWords = prefixWords.filter((w) => !GENERIC_CONTEXT_WORDS.has(w));
      if (informativePrefixWords.length > 0) {
        return formatKeyByStyle(prefixWords, keyStyle);
      }
    }

    // B. Word-level semantic translation using UI vocabulary map
    const rawWords = normalizedKey.split(/\s+/).filter(Boolean);
    const translatedWords: string[] = [];

    for (const w of rawWords) {
      if (FOREIGN_STOP_WORDS.has(w)) continue; // omit articles/prepositions
      if (WORD_TRANSLATION_MAP[w]) {
        translatedWords.push(WORD_TRANSLATION_MAP[w]!);
      } else if (/^[a-z0-9]+$/.test(w) && w.length > 2) {
        // preserve already-English or numeric tokens
        translatedWords.push(w);
      }
    }

    if (translatedWords.length > 0) {
      // Split compound translated tokens (e.g. "first_name" -> "first", "name")
      const finalWords = translatedWords.flatMap((w) => w.split("_")).slice(0, 5);
      return formatKeyByStyle(finalWords, keyStyle);
    }

    // C. Fallback to context prefix if present
    if (contextPrefix) {
      const prefixWords = extractContextWords(contextPrefix);
      if (prefixWords.length > 0) {
        return formatKeyByStyle(prefixWords, keyStyle);
      }
    }
  }

  // 4. Standard English text handling
  const words = latinClean
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

  // Cap at 5 words to avoid huge sentence keys
  const selectedWords = words.slice(0, 5);

  return formatKeyByStyle(selectedWords, keyStyle) || "KEY";
}
