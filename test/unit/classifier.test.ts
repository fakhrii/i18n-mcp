import { describe, it, expect } from "vitest";
import {
  classifyString,
  isUserFacingClassification,
  getConfidenceLevel,
} from "../../src/core/classifier/classifier.js";

describe("Classifier & Confidence Engine", () => {
  it("classifies JSX text as USER_FACING / UI_TEXT with high confidence", () => {
    const result = classifyString({
      text: "Welcome back",
      astType: "JSX_TEXT",
      componentName: "Text",
    });

    expect(result.classification).toBe("UI_TEXT");
    expect(result.isUserFacing).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.confidenceLevel).toBe("HIGH");
  });

  it("classifies placeholder attributes as PLACEHOLDER", () => {
    const result = classifyString({
      text: "Enter your email",
      astType: "JSX_ATTRIBUTE",
      propName: "placeholder",
      componentName: "TextInput",
    });

    expect(result.classification).toBe("PLACEHOLDER");
    expect(result.isUserFacing).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies button title attributes as BUTTON", () => {
    const result = classifyString({
      text: "Continue",
      astType: "JSX_ATTRIBUTE",
      propName: "title",
      componentName: "Button",
    });

    expect(result.classification).toBe("BUTTON");
    expect(result.isUserFacing).toBe(true);
  });

  it("classifies accessibilityLabel attributes as ACCESSIBILITY", () => {
    const result = classifyString({
      text: "Close menu",
      astType: "JSX_ATTRIBUTE",
      propName: "accessibilityLabel",
    });

    expect(result.classification).toBe("ACCESSIBILITY");
    expect(result.isUserFacing).toBe(true);
  });

  it("classifies Alert dialogs and toasts as NOTIFICATION", () => {
    const alertResult = classifyString({
      text: "Something went wrong",
      astType: "CALL_EXPRESSION",
      calleeName: "Alert.alert",
    });
    expect(alertResult.classification).toBe("NOTIFICATION");
    expect(alertResult.isUserFacing).toBe(true);

    const toastResult = classifyString({
      text: "Profile updated successfully",
      astType: "CALL_EXPRESSION",
      calleeName: "showToast",
    });
    expect(toastResult.classification).toBe("NOTIFICATION");
    expect(toastResult.isUserFacing).toBe(true);
  });

  it("classifies setError calls as VALIDATION_MESSAGE", () => {
    const result = classifyString({
      text: "Invalid email address",
      astType: "CALL_EXPRESSION",
      calleeName: "setError",
    });

    expect(result.classification).toBe("VALIDATION_MESSAGE");
    expect(result.isUserFacing).toBe(true);
  });

  it("identifies URLs, file paths, colors, and testIDs as TECHNICAL", () => {
    const url = classifyString({ text: "https://api.example.com/v1", astType: "STRING_LITERAL" });
    expect(url.classification).toBe("URL");
    expect(url.isUserFacing).toBe(false);

    const path = classifyString({ text: "./assets/images/logo.png", astType: "STRING_LITERAL" });
    expect(path.classification).toBe("PATH");
    expect(path.isUserFacing).toBe(false);

    const hexColor = classifyString({ text: "#FFFFFF", astType: "STRING_LITERAL" });
    expect(hexColor.classification).toBe("TECHNICAL");
    expect(hexColor.isUserFacing).toBe(false);

    const testId = classifyString({
      text: "submit_button",
      astType: "JSX_ATTRIBUTE",
      propName: "testID",
    });
    expect(testId.classification).toBe("IDENTIFIER");
    expect(testId.isUserFacing).toBe(false);
  });

  it("identifies binary comparisons and switch cases as ENUM / TECHNICAL", () => {
    const comparison = classifyString({
      text: "pending",
      astType: "STRING_LITERAL",
      isComparison: true,
    });
    expect(comparison.classification).toBe("ENUM");
    expect(comparison.isUserFacing).toBe(false);

    const switchCase = classifyString({
      text: "active",
      astType: "STRING_LITERAL",
      isSwitchCase: true,
    });
    expect(switchCase.classification).toBe("ENUM");
    expect(switchCase.isUserFacing).toBe(false);
  });

  it("identifies console.log and analytics calls as TECHNICAL", () => {
    const log = classifyString({
      text: "User logged in",
      astType: "CALL_EXPRESSION",
      calleeName: "console.log",
    });
    expect(log.classification).toBe("LOG");
    expect(log.isUserFacing).toBe(false);

    const track = classifyString({
      text: "LOGIN_CLICKED",
      astType: "CALL_EXPRESSION",
      calleeName: "analytics.track",
    });
    expect(track.classification).toBe("ANALYTICS_EVENT");
    expect(track.isUserFacing).toBe(false);
  });

  it("identifies SVG path data and SVG component attributes as TECHNICAL", () => {
    const svgPath =
      "M8.00065 14.6673C11.6673 14.6673 14.6673 11.6673 14.6673 8.00065C14.6673 4.33398 11.6673 1.33398 8.00065 1.33398C4.33398 1.33398 1.33398 4.33398 1.33398 8.00065C1.33398 11.6673 4.33398 14.6673 8.00065 14.6673Z";

    const pathResult = classifyString({
      text: svgPath,
      astType: "JSX_ATTRIBUTE",
      propName: "d",
      componentName: "Path",
    });
    expect(pathResult.classification).toBe("TECHNICAL");
    expect(pathResult.isUserFacing).toBe(false);

    // Even without propName or componentName, SVG path data is recognized as technical
    const standalonePathResult = classifyString({
      text: svgPath,
      astType: "STRING_LITERAL",
    });
    expect(standalonePathResult.classification).toBe("TECHNICAL");
    expect(standalonePathResult.isUserFacing).toBe(false);

    const viewBoxResult = classifyString({
      text: "0 0 24 24",
      astType: "JSX_ATTRIBUTE",
      propName: "viewBox",
      componentName: "Svg",
    });
    expect(viewBoxResult.classification).toBe("TECHNICAL");
    expect(viewBoxResult.isUserFacing).toBe(false);
  });

  it("identifies date format masks, date units, and formatter arguments as TECHNICAL", () => {
    // Exact user case: YYYY-MM-DD in format call
    const dateFormatResult = classifyString({
      text: "YYYY-MM-DD",
      astType: "CALL_EXPRESSION",
      calleeName: "moment().year(year).endOf('year').format",
    });
    expect(dateFormatResult.classification).toBe("TECHNICAL");
    expect(dateFormatResult.isUserFacing).toBe(false);

    // Standalone date masks
    expect(classifyString({ text: "YYYY-MM-DD", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "DD/MM/YYYY", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "HH:mm:ss", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "YYYY", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);

    // Date unit
    expect(classifyString({ text: "year", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "months", astType: "STRING_LITERAL" }).isUserFacing).toBe(false);
  });

  it("identifies CSS style props like boxShadow, textAlign, and style context as TECHNICAL", () => {
    // Exact user case: boxShadow and textAlign
    const boxShadowProp = classifyString({
      text: "0 2px 4px rgba(0,0,0,0.1)",
      astType: "JSX_ATTRIBUTE",
      propName: "boxShadow",
    });
    expect(boxShadowProp.classification).toBe("TECHNICAL");
    expect(boxShadowProp.isUserFacing).toBe(false);

    const textAlignProp = classifyString({
      text: "center",
      astType: "JSX_ATTRIBUTE",
      propName: "textAlign",
    });
    expect(textAlignProp.classification).toBe("TECHNICAL");
    expect(textAlignProp.isUserFacing).toBe(false);

    // Kebab-case and camelCase style props
    expect(classifyString({ text: "center", astType: "JSX_ATTRIBUTE", propName: "text-align" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "none", astType: "JSX_ATTRIBUTE", propName: "box-shadow" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "row", astType: "JSX_ATTRIBUTE", propName: "flexDirection" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "16px", astType: "JSX_ATTRIBUTE", propName: "fontSize" }).isUserFacing).toBe(false);

    // Multi-shadow values
    const multiShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
    expect(classifyString({ text: multiShadow, astType: "STRING_LITERAL" }).isUserFacing).toBe(false);

    // In style context (e.g. StyleSheet.create)
    const styleContextResult = classifyString({
      text: "Open Sans, sans-serif",
      astType: "OBJECT_PROPERTY",
      propName: "fontFamily",
      isStyleContext: true,
    });
    expect(styleContextResult.classification).toBe("TECHNICAL");
    expect(styleContextResult.isUserFacing).toBe(false);

    // Ensure natural language words in user-facing elements are NOT swallowed
    const buttonWithKeyword = classifyString({
      text: "Normal",
      astType: "JSX_ATTRIBUTE",
      propName: "title",
      componentName: "Button",
    });
    expect(buttonWithKeyword.classification).toBe("BUTTON");
    expect(buttonWithKeyword.isUserFacing).toBe(true);

    const jsxTextWithKeyword = classifyString({
      text: "Center",
      astType: "JSX_TEXT",
      componentName: "Text",
    });
    expect(jsxTextWithKeyword.classification).toBe("UI_TEXT");
    expect(jsxTextWithKeyword.isUserFacing).toBe(true);
  });

  it("identifies strings composed only of variables or variables and punctuation as TECHNICAL", () => {
    // Exact user case: contact givenName and familyName
    const contactNames = classifyString({
      text: "{{contactgivenName}} {{contactfamilyName}}",
      astType: "TEMPLATE_LITERAL",
    });
    expect(contactNames.classification).toBe("TECHNICAL");
    expect(contactNames.isUserFacing).toBe(false);

    // Other variable and punctuation only combinations
    expect(classifyString({ text: "{{firstName}}, {{lastName}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "({{areaCode}}) {{phoneNumber}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "{{year}}-{{month}}-{{day}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "{{width}}x{{height}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "{{size}}px", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "{{protocol}}://{{domain}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "user_{{id}}", astType: "TEMPLATE_LITERAL" }).isUserFacing).toBe(false);

    // Ensure template literals with actual translatable words remain USER_FACING
    const greeting = classifyString({
      text: "Hello {{name}}",
      astType: "TEMPLATE_LITERAL",
    });
    expect(greeting.classification).toBe("USER_FACING");
    expect(greeting.isUserFacing).toBe(true);

    const countItems = classifyString({
      text: "{{count}} items selected",
      astType: "TEMPLATE_LITERAL",
    });
    expect(countItems.classification).toBe("USER_FACING");
    expect(countItems.isUserFacing).toBe(true);
  });

  it("identifies SCREAMING_SNAKE_CASE and Hierarchical SCREAMING_SNAKE_CASE as IDENTIFIER (technical)", () => {
    // Pure SCREAMING_SNAKE_CASE
    const screamingCases = [
      "USER_LOGIN",
      "AUTH_TOKEN",
      "NETWORK_ERROR",
      "HTTP_500_INTERNAL_SERVER_ERROR",
      "_PRIVATE_ACTION_KEY_",
      "STATUS_PENDING",
      "API_V2_KEY",
    ];

    for (const text of screamingCases) {
      const result = classifyString({ text, astType: "STRING_LITERAL" });
      expect(result.classification).toBe("IDENTIFIER");
      expect(result.isUserFacing).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    }

    // Even if in user-facing props or JSX text, SCREAMING_SNAKE_CASE should not be user-facing
    expect(classifyString({ text: "USER_LOGIN", astType: "JSX_TEXT" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "SUBMIT_FORM", astType: "JSX_ATTRIBUTE", propName: "title", componentName: "Button" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "AUTH_REQUIRED", astType: "CALL_EXPRESSION", calleeName: "setError" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "ALERT_TITLE", astType: "CALL_EXPRESSION", calleeName: "Alert.alert" }).isUserFacing).toBe(false);

    // Hierarchical SCREAMING_SNAKE_CASE (dot, slash, colon, double-colon)
    const hierarchicalCases = [
      "AUTH.LOGIN_SUCCESS",
      "USER/FETCH_PROFILE",
      "DEVICE::GET_CONTACTS",
      "AUTH:LOGIN",
      "SETTINGS.ACCOUNT.CHANGE_PASSWORD",
      "@app/AUTH_LOGIN",
      "auth/LOGIN_SUCCESS",
      "MODULE::ACTION_NAME",
      "APP.NAVIGATION.HOME_SCREEN",
      "AUTH.LOGIN",
    ];

    for (const text of hierarchicalCases) {
      const result = classifyString({ text, astType: "STRING_LITERAL" });
      expect(result.classification).toBe("IDENTIFIER");
      expect(result.isUserFacing).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    }

    // Ensure normal UI text and single-word caps buttons are NOT ignored
    expect(classifyString({ text: "Welcome back", astType: "JSX_TEXT" }).isUserFacing).toBe(true);
    expect(classifyString({ text: "SUBMIT", astType: "JSX_ATTRIBUTE", propName: "title", componentName: "Button" }).isUserFacing).toBe(true);
    expect(classifyString({ text: "OK", astType: "JSX_TEXT", componentName: "Text" }).isUserFacing).toBe(true);
  });

  it("identifies technical config props and enum tokens like status, size, position as ENUM (technical)", () => {
    // Exact user case: showToast options
    const statusProp = classifyString({
      text: "success",
      astType: "OBJECT_PROPERTY",
      propName: "status",
      calleeName: "showToast",
    });
    expect(statusProp.classification).toBe("ENUM");
    expect(statusProp.isUserFacing).toBe(false);

    const sizeProp = classifyString({
      text: "lg",
      astType: "OBJECT_PROPERTY",
      propName: "size",
      calleeName: "showToast",
    });
    expect(sizeProp.classification).toBe("ENUM");
    expect(sizeProp.isUserFacing).toBe(false);

    const positionProp = classifyString({
      text: "bottom",
      astType: "OBJECT_PROPERTY",
      propName: "position",
      calleeName: "showToast",
    });
    expect(positionProp.classification).toBe("TECHNICAL");
    expect(positionProp.isUserFacing).toBe(false);

    // Toast message property in options object should be user-facing
    const messageProp = classifyString({
      text: "Download completed successfully",
      astType: "OBJECT_PROPERTY",
      propName: "message",
      calleeName: "showToast",
    });
    expect(messageProp.classification).toBe("NOTIFICATION");
    expect(messageProp.isUserFacing).toBe(true);

    // Component enum props in JSX
    expect(classifyString({ text: "lg", astType: "JSX_ATTRIBUTE", propName: "size" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "sm", astType: "JSX_ATTRIBUTE", propName: "size" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "success", astType: "JSX_ATTRIBUTE", propName: "status" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "outline", astType: "JSX_ATTRIBUTE", propName: "variant" }).isUserFacing).toBe(false);
    expect(classifyString({ text: "top-right", astType: "JSX_ATTRIBUTE", propName: "placement" }).isUserFacing).toBe(false);
  });

  it("correctly maps confidence levels (HIGH, MEDIUM, LOW)", () => {
    expect(getConfidenceLevel(0.95)).toBe("HIGH");
    expect(getConfidenceLevel(0.85)).toBe("HIGH");
    expect(getConfidenceLevel(0.84)).toBe("MEDIUM");
    expect(getConfidenceLevel(0.50)).toBe("MEDIUM");
    expect(getConfidenceLevel(0.49)).toBe("LOW");
  });
});

