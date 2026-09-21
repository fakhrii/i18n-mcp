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

  it("falls back gracefully when text contains only punctuation", () => {
    expect(generateSemanticKey("---")).toBe("TEXT");
    expect(generateSemanticKey("...", "BTN")).toBe("BTN_TEXT");
  });
});
