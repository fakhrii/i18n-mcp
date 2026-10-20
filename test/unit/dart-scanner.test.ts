import { describe, it, expect } from "vitest";
import { scanDartSourceFile } from "../../src/core/scanner/dart-scanner.js";

describe("Phase P2: Flutter & Dart Source Scanner", () => {
  it("detects user-facing strings in Flutter Text widgets", () => {
    const code = `
      import 'package:flutter/material.dart';

      class WelcomePage extends StatelessWidget {
        @override
        Widget build(BuildContext context) {
          return Scaffold(
            appBar: AppBar(
              title: Text('Dashboard'),
            ),
            body: Center(
              child: Text("Welcome back to your account"),
            ),
          );
        }
      }
    `;

    const results = scanDartSourceFile({ filePath: "lib/welcome_page.dart", sourceCode: code });
    expect(results).toHaveLength(2);

    const [titleItem, welcomeItem] = results;
    expect(titleItem!.text).toBe("Dashboard");
    expect(titleItem!.suggestedKey).toBe("dashboard");

    expect(welcomeItem!.text).toBe("Welcome back to your account");
    expect(welcomeItem!.suggestedKey).toBe("welcomeBackToYourAccount");
  });

  it("detects input field properties like hintText, helperText, and errorText", () => {
    const code = `
      final input = InputDecoration(
        labelText: 'Email Address',
        hintText: 'Enter your email',
        errorText: 'Invalid email format',
      );
    `;

    const results = scanDartSourceFile({ filePath: "lib/login_form.dart", sourceCode: code });
    expect(results).toHaveLength(3);

    const keys = results.map((r) => r.suggestedKey);
    expect(keys).toContain("emailAddress");
    expect(keys).toContain("enterYourEmail");
    expect(keys).toContain("invalidEmailFormat");
  });

  it("extracts Dart string interpolations ($count and \${user.name})", () => {
    const code = `
      final msg1 = Text('You have $unreadCount messages');
      final msg2 = Text('Welcome, \${user.name}!');
    `;

    const results = scanDartSourceFile({ filePath: "lib/msg.dart", sourceCode: code });
    expect(results).toHaveLength(2);

    expect(results[0]!.text).toBe("You have {{unreadCount}} messages");
    expect(results[0]!.variables).toEqual(["unreadCount"]);
    expect(results[0]!.variableExpressions).toEqual({ unreadCount: "unreadCount" });

    expect(results[1]!.text).toBe("Welcome, {{name}}!");
    expect(results[1]!.variables).toEqual(["name"]);
    expect(results[1]!.variableExpressions).toEqual({ name: "user.name" });
  });

  it("detects plural semantics in Dart interpolations with count variables", () => {
    const code = `
      final msg = Text('$count items in cart');
    `;

    const results = scanDartSourceFile({ filePath: "lib/cart.dart", sourceCode: code });
    expect(results).toHaveLength(1);
    expect(results[0]!.isPlural).toBe(true);
    expect(results[0]!.pluralVariable).toBe("count");
    expect(results[0]!.pluralForm).toEqual({
      one: "{{count}} item in cart",
      other: "{{count}} items in cart",
    });
  });

  it("skips imports, print/debug statements, Key constructors, and comments", () => {
    const code = `
      import 'package:flutter/material.dart';
      // ignore: unused_import
      import 'package:http/http.dart' as http;

      // This is a comment with 'hello'
      /* Multiline
         comment with 'world'
      */
      void debugFlow() {
        print('Debug message: user logged in');
        debugPrint('Another internal trace');
        final key = Key('unique_login_button');
        final asset = 'assets/icons/logo.png';
      }
    `;

    const results = scanDartSourceFile({ filePath: "lib/debug.dart", sourceCode: code });
    expect(results).toHaveLength(0);
  });

  it("detects user-facing strings across newlines in multiline widgets and props", () => {
    const code = `
      final widget = Text(
        'Multiline Title Content',
        style: TextStyle(fontSize: 16),
      );
      final input = InputDecoration(
        hintText:
            'Enter your phone number',
      );
    `;

    const results = scanDartSourceFile({ filePath: "lib/multiline.dart", sourceCode: code });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.text)).toContain("Multiline Title Content");
    expect(results.map((r) => r.text)).toContain("Enter your phone number");
  });
});
