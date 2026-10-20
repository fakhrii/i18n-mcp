import { describe, it, expect } from "vitest";
import { generateSemanticKey } from "../../src/core/keys/key-generator.js";

describe("Key Generator", () => {
  it("converts simple phrases to UPPER_SNAKE_CASE", () => {
    expect(generateSemanticKey("Welcome back")).toBe("WELCOME_BACK");
    expect(generateSemanticKey("Forgot password?")).toBe("FORGOT_PASSWORD");
    expect(generateSemanticKey("Payment successful")).toBe("PAYMENT_SUCCESSFUL");
  });

  it("maps common actions to standard semantic keys", () => {
    expect(generateSemanticKey("Save")).toBe("SAVE");
    expect(generateSemanticKey("Cancel")).toBe("CANCEL");
    expect(generateSemanticKey("Close")).toBe("CLOSE");
    expect(generateSemanticKey("Log in")).toBe("LOGIN");
    expect(generateSemanticKey("Sign In")).toBe("SIGN_IN");
    expect(generateSemanticKey("Loading...")).toBe("LOADING");
    expect(generateSemanticKey("Try again later")).toBe("TRY_AGAIN_LATER");
  });

  it("cleans special characters, punctuation, and interpolations", () => {
    expect(generateSemanticKey("Hello {{name}}, how are you?")).toBe("HELLO_HOW_ARE_YOU");
    expect(generateSemanticKey("User's profile & settings!")).toBe("USER_S_PROFILE_SETTINGS");
  });

  it("caps very long sentences to 5 words to prevent oversized keys", () => {
    const longText = "This is an extremely long sentence that should not become an enormous translation key";
    const key = generateSemanticKey(longText);
    expect(key).toBe("THIS_IS_AN_EXTREMELY_LONG");
  });

  it("guarantees English keys for Latin non-English text", () => {
    // French, German, Spanish common actions and phrases
    expect(generateSemanticKey("Créer un compte")).toBe("CREATE_ACCOUNT");
    expect(generateSemanticKey("Über uns")).toBe("ABOUT_US");
    expect(generateSemanticKey("Año nuevo")).toBe("NEW_YEAR");
    expect(generateSemanticKey("Mot de passe oublié ?")).toBe("FORGOT_PASSWORD");
    expect(generateSemanticKey("Enregistrer les modifications")).toBe("SAVE_CHANGES");
    expect(generateSemanticKey("Passwort vergessen")).toBe("FORGOT_PASSWORD");
    expect(generateSemanticKey("Benutzerkonto erstellen")).toBe("CREATE_ACCOUNT");
    expect(generateSemanticKey("Iniciar sesión")).toBe("LOGIN");
    expect(generateSemanticKey("Cerrar sesión")).toBe("LOGOUT");
    expect(generateSemanticKey("Bienvenue de nouveau")).toBe("WELCOME_BACK");
    expect(generateSemanticKey("Se déconnecter")).toBe("LOGOUT");
  });

  it("translates word-level Latin UI phrases to English keys", () => {
    expect(generateSemanticKey("Créer un nouveau profil")).toBe("CREATE_NEW_PROFILE");
    expect(generateSemanticKey("Modifier les détails")).toBe("EDIT_DETAILS");
    expect(generateSemanticKey("Ajouter un produit")).toBe("ADD_PRODUCT");
  });

  it("uses context-first naming for Latin non-English text when informative context is provided", () => {
    expect(generateSemanticKey("Commander vos articles", "submitOrderButton")).toBe("SUBMIT_ORDER_BUTTON");
    expect(generateSemanticKey("Modifier vos paramètres", "editSettings")).toBe("EDIT_SETTINGS");
  });

  it("supports lowerCamelCase keyStyle for Flutter ARB keys", () => {
    expect(generateSemanticKey("Créer un compte", undefined, "lowerCamelCase")).toBe("createAccount");
    expect(generateSemanticKey("Über uns", undefined, "lowerCamelCase")).toBe("aboutUs");
    expect(generateSemanticKey("Año nuevo", undefined, "lowerCamelCase")).toBe("newYear");
    expect(generateSemanticKey("Mot de passe oublié ?", undefined, "lowerCamelCase")).toBe("forgotPassword");
  });

  it("uses context-first naming for non-Latin strings", () => {
    expect(generateSemanticKey("登录", "loginButton")).toBe("LOGIN_BUTTON");
    expect(generateSemanticKey("تسجيل الدخول", "signInButton")).toBe("SIGN_IN_BUTTON");
    expect(generateSemanticKey("Войти", "loginTitle")).toBe("LOGIN_TITLE");
    expect(generateSemanticKey("こんにちは", "headerTitle")).toBe("HEADER_TITLE");
  });
});
