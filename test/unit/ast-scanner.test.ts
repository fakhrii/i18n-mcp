import { describe, it, expect } from "vitest";
import { scanSourceFileAst } from "../../src/core/scanner/ast-scanner.js";

describe("AST Scanner", () => {
  it("detects JSX text elements", () => {
    const code = `
      import React from "react";
      import { View, Text } from "react-native";
      export function Screen() {
        return (
          <View>
            <Text>Welcome back</Text>
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/auth/Screen.tsx",
      sourceCode: code,
      knownNamespaces: ["auth", "common"],
      onlyUserFacing: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Welcome back");
    expect(results[0]?.type).toBe("JSX_TEXT");
    expect(results[0]?.classification).toBe("UI_TEXT");
    expect(results[0]?.confidence).toBeGreaterThanOrEqual(0.95);
    expect(results[0]?.suggestedKey).toBe("WELCOME_BACK");
    expect(results[0]?.suggestedNamespace).toBe("auth");
  });

  it("detects JSX attributes (title, placeholder, accessibility)", () => {
    const code = `
      import React from "react";
      import { View, Button, TextInput } from "react-native";
      export function Screen() {
        return (
          <View accessibilityLabel="Main container">
            <TextInput placeholder="Enter your email" />
            <Button title="Continue" />
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/auth/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    const texts = results.map((r) => r.text);
    expect(texts).toContain("Main container");
    expect(texts).toContain("Enter your email");
    expect(texts).toContain("Continue");

    const placeholder = results.find((r) => r.text === "Enter your email");
    expect(placeholder?.type).toBe("JSX_ATTRIBUTE");
    expect(placeholder?.propName).toBe("placeholder");
    expect(placeholder?.classification).toBe("PLACEHOLDER");

    const button = results.find((r) => r.text === "Continue");
    expect(button?.classification).toBe("BUTTON");
    expect(button?.suggestedKey).toBe("CONTINUE");
  });

  it("detects Alert, toast, and validation calls", () => {
    const code = `
      import { Alert } from "react-native";
      function doAction() {
        Alert.alert("Error", "Something went wrong");
        showToast("Profile updated");
        setError("Invalid email address");
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/profile/actions.ts",
      sourceCode: code,
      onlyUserFacing: true,
    });

    const texts = results.map((r) => r.text);
    expect(texts).toContain("Error");
    expect(texts).toContain("Something went wrong");
    expect(texts).toContain("Profile updated");
    expect(texts).toContain("Invalid email address");
  });

  it("detects navigation and object properties", () => {
    const code = `
      function configure(navigation) {
        navigation.setOptions({
          title: "Profile",
        });

        const options = [
          { label: "Daily", description: "Every day" },
          { label: "Weekly", description: "Every week" }
        ];
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/settings/config.ts",
      sourceCode: code,
      onlyUserFacing: true,
    });

    const texts = results.map((r) => r.text);
    expect(texts).toContain("Profile");
    expect(texts).toContain("Daily");
    expect(texts).toContain("Every day");
  });

  it("detects template literals with variables", () => {
    const code = `
      import React from "react";
      import { Text } from "react-native";
      export function Greeting({ name, count }) {
        return <Text>{\`Hello \${name}, you have \${count} items\`}</Text>;
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/home/Greeting.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Hello {{name}}, you have {{count}} items");
    expect(results[0]?.type).toBe("TEMPLATE_LITERAL");
    expect(results[0]?.variables).toEqual(["name", "count"]);
  });

  it("detects custom component user-facing props", () => {
    const code = `
      import React from "react";
      import { EmptyState } from "../components/EmptyState";
      export function Screen() {
        return (
          <EmptyState
            title="No transactions found"
            message="Try again later"
          />
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/transactions/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    const texts = results.map((r) => r.text);
    expect(texts).toContain("No transactions found");
    expect(texts).toContain("Try again later");
    const tryAgain = results.find((r) => r.text === "Try again later");
    expect(tryAgain?.suggestedKey).toBe("TRY_AGAIN_LATER");
  });

  it("ignores existing translations like t() and i18n.t()", () => {
    const code = `
      import React from "react";
      import { View, Text } from "react-native";
      import { useTranslation } from "react-i18next";
      export function Screen() {
        const { t } = useTranslation("auth");
        return (
          <View>
            <Text>{t("LOGIN")}</Text>
            <Text>{i18n.t("CANCEL")}</Text>
            <Text>Hardcoded string</Text>
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/auth/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Hardcoded string");
  });

  it("ignores technical strings, logs, testIDs, and comparisons when onlyUserFacing is true", () => {
    const code = `
      console.log("User logged in");
      analytics.track("LOGIN_PRESSED");
      const url = "https://api.example.com";
      const color = "#FFFFFF";
      if (status === "pending") {
        doSomething();
      }
      return <Button testID="login_btn" title="Submit" />;
    `;

    const userFacing = scanSourceFileAst({
      filePath: "src/features/auth/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    expect(userFacing).toHaveLength(1);
    expect(userFacing[0]?.text).toBe("Submit");

    // When onlyUserFacing is false, technical strings are included with their classification
    const all = scanSourceFileAst({
      filePath: "src/features/auth/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: false,
    });

    const classes = all.map((r) => r.classification);
    expect(classes).toContain("LOG");
    expect(classes).toContain("ANALYTICS_EVENT");
    expect(classes).toContain("URL");
    expect(classes).toContain("TECHNICAL");
    expect(classes).toContain("ENUM");
    expect(classes).toContain("IDENTIFIER");
  });

  it("does not detect SVG path data or vector icon names as user-facing strings", () => {
    const code = `
      import React from "react";
      import Svg, { Path } from "react-native-svg";
      import Icon from "react-native-vector-icons/Feather";

      export function MoreCircle() {
        return (
          <Svg viewBox="0 0 24 24">
            <Path
              d="M8.00065 14.6673C11.6673 14.6673 14.6673 11.6673 14.6673 8.00065C14.6673 4.33398 11.6673 1.33398 8.00065 1.33398C4.33398 1.33398 1.33398 4.33398 1.33398 8.00065C1.33398 11.6673 4.33398 14.6673 8.00065 14.6673Z"
              fill="#000"
            />
            <Icon name="chevron-right" size={24} color="#333" />
          </Svg>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/assets/customImage/MoreCircle.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // None of the SVG props (viewBox, d, fill, color, size, name) should be detected as user-facing!
    expect(results).toHaveLength(0);
  });

  it("does not detect date format strings or moment/dayjs manipulation calls as user-facing", () => {
    const code = `
      import moment from "moment";

      export function formatDate(year) {
        const dateStr = moment().year(year).endOf('year').format("YYYY-MM-DD");
        const timeStr = moment().format("HH:mm:ss");
        const customFormat = "DD/MM/YYYY";
        return dateStr;
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/helpers/commonfunctions.ts",
      sourceCode: code,
      onlyUserFacing: true,
    });

    expect(results).toHaveLength(0);
  });

  it("does not detect CSS props like boxShadow, textAlign, or StyleSheet.create styles as user-facing", () => {
    const code = `
      import React from "react";
      import { View, Text, StyleSheet, Button } from "react-native";

      const styles = StyleSheet.create({
        container: {
          flex: 1,
          textAlign: "center",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          backgroundColor: "#ffffff",
          fontFamily: "Open Sans, sans-serif",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        card: {
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
        },
      });

      export function DashboardScreen() {
        return (
          <View style={styles.container}>
            <View style={{ textAlign: "right", boxShadow: "none" }} />
            <Text textAlign="center" boxShadow="0 1px 2px #000">
              Welcome to the dashboard
            </Text>
            <Button title="Save changes" />
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/dashboard/DashboardScreen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // Only "Welcome to the dashboard" and "Save changes" should be detected!
    expect(results).toHaveLength(2);
    const texts = results.map((r) => r.text);
    expect(texts).toContain("Welcome to the dashboard");
    expect(texts).toContain("Save changes");

    // Verify none of the CSS strings are present
    expect(texts).not.toContain("center");
    expect(texts).not.toContain("0 2px 4px rgba(0,0,0,0.1)");
    expect(texts).not.toContain("none");
    expect(texts).not.toContain("right");
    expect(texts).not.toContain("Open Sans, sans-serif");
    expect(texts).not.toContain("0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)");
  });

  it("does not detect template literals composed only of variables and punctuation as user-facing", () => {
    const code = `
      // Store / helper with variable interpolations
      export function getContactDetails(contact) {
        const fullName = \`\${contact.givenName} \${contact.familyName}\`;
        const address = \`\${contact.city}, \${contact.country}\`;
        const phone = \`(\${contact.areaCode}) \${contact.phoneNumber}\`;
        const cacheKey = \`contact_\${contact.id}\`;
        const endpoint = \`/api/contacts/\${contact.id}\`;
        const realGreeting = \`Hello \${contact.givenName}, welcome back!\`;
        return { fullName, address, phone, realGreeting };
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/store/deviceContactsStore.ts",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // Only "Hello {{givenName}}, welcome back!" should be detected!
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Hello {{givenName}}, welcome back!");
    expect(results[0]?.suggestedKey).toBe("HELLO_WELCOME_BACK");

    // When onlyUserFacing is false, the variable-only strings appear as TECHNICAL
    const allResults = scanSourceFileAst({
      filePath: "src/store/deviceContactsStore.ts",
      sourceCode: code,
      onlyUserFacing: false,
    });

    const technicalReasons = allResults.map((r) => r.reason);
    expect(technicalReasons).toContain("Composed only of variables and punctuation");
  });

  it("does not detect SCREAMING_SNAKE_CASE or Hierarchical SCREAMING_SNAKE_CASE as user-facing", () => {
    const code = `
      import React from "react";
      import { View, Text, Button, Alert } from "react-native";

      const ACTION_TYPE = "USER_LOGIN_REQUEST";
      const EVENT_NAME = "AUTH.LOGIN_SUCCESS";
      const MODULE_NAME = "DEVICE::GET_CONTACTS";
      const ROUTE_NAME = "NAV/HOME_SCREEN";

      export function AuthComponent({ dispatch, setError }) {
        const handleLogin = () => {
          dispatch({ type: "USER/FETCH_PROFILE" });
          dispatch({ type: "SETTINGS.ACCOUNT.CHANGE_PASSWORD" });
          setError("AUTH_INVALID_CREDENTIALS");
          Alert.alert("ERROR_DIALOG_TITLE", "NETWORK_ERROR");
        };

        return (
          <View>
            <Text>Welcome back to the app</Text>
            <Text>USER_PROFILE_BANNER</Text>
            <Button title="Continue to dashboard" />
            <Button title="SUBMIT_FORM_ACTION" />
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/features/auth/AuthComponent.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // Only "Welcome back to the app" and "Continue to dashboard" should be detected!
    expect(results).toHaveLength(2);
    const texts = results.map((r) => r.text);
    expect(texts).toContain("Welcome back to the app");
    expect(texts).toContain("Continue to dashboard");

    // All SCREAMING_SNAKE_CASE and hierarchical strings must be ignored!
    expect(texts).not.toContain("USER_LOGIN_REQUEST");
    expect(texts).not.toContain("AUTH.LOGIN_SUCCESS");
    expect(texts).not.toContain("DEVICE::GET_CONTACTS");
    expect(texts).not.toContain("NAV/HOME_SCREEN");
    expect(texts).not.toContain("USER/FETCH_PROFILE");
    expect(texts).not.toContain("SETTINGS.ACCOUNT.CHANGE_PASSWORD");
    expect(texts).not.toContain("AUTH_INVALID_CREDENTIALS");
    expect(texts).not.toContain("ERROR_DIALOG_TITLE");
    expect(texts).not.toContain("NETWORK_ERROR");
    expect(texts).not.toContain("USER_PROFILE_BANNER");
    expect(texts).not.toContain("SUBMIT_FORM_ACTION");
  });

  it("does not detect technical props like status, size, position in showToast calls or components", () => {
    const code = `
      import React from "react";
      import { t } from "i18next";

      export function exportHandler() {
        // Exact user snippet
        showToast({
          message: t('TOAST.SUCCESS.DOWNLOAD_TRANSACTION'),
          status: 'success',
          position: 'bottom',
          size: 'lg',
          duration: 3000,
        });

        // Untranslated message in toast
        showToast({
          message: 'Export file has been generated',
          status: 'info',
          size: 'md',
          position: 'top',
        });
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/helpers/exportHandler.ts",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // Only "Export file has been generated" should be detected!
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Export file has been generated");

    // "success", "lg", "bottom", "info", "md", "top" must NOT be detected!
    const texts = results.map((r) => r.text);
    expect(texts).not.toContain("success");
    expect(texts).not.toContain("lg");
    expect(texts).not.toContain("bottom");
    expect(texts).not.toContain("info");
    expect(texts).not.toContain("md");
    expect(texts).not.toContain("top");
  });

  it("ignores strings declared inside mock data variables", () => {
    const code = `
      import React from "react";
      import { View, Text } from "react-native";

      const MOCK_USERS = [
        { id: "1", name: "John Doe", role: "Admin", bio: "Software engineer" },
        { id: "2", name: "Jane Smith", role: "Editor", bio: "Writer" },
      ];

      const dummyFeed = [
        { title: "Mock Post 1", description: "Lorem ipsum dolor sit amet" }
      ];

      export function Screen() {
        return (
          <View>
            <Text>Real Screen Title</Text>
          </View>
        );
      }
    `;

    const results = scanSourceFileAst({
      filePath: "src/screens/Screen.tsx",
      sourceCode: code,
      onlyUserFacing: true,
    });

    // Only "Real Screen Title" should be detected!
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Real Screen Title");

    const texts = results.map((r) => r.text);
    expect(texts).not.toContain("John Doe");
    expect(texts).not.toContain("Admin");
    expect(texts).not.toContain("Software engineer");
    expect(texts).not.toContain("Jane Smith");
    expect(texts).not.toContain("Editor");
    expect(texts).not.toContain("Writer");
    expect(texts).not.toContain("Mock Post 1");
    expect(texts).not.toContain("Lorem ipsum dolor sit amet");
  });
});


