---
name: internationalize
description: >-
  Internationalize React Native, React (web), Next.js, or Flutter projects, features, screens, or components using the i18n MCP server.
  Use when the user invokes /internationalize or asks to extract hardcoded strings, translate text,
  or internationalize a module.
---

# Multi-Framework Internationalization Skill (`/internationalize`)

This skill orchestrates the end-to-end internationalization pipeline across **React Native**, **React (web)**, **Next.js**, and **Flutter** projects by delegating directly to the MCP tool `internationalize`.

## Core Principles

1. **Thin Agent UX Layer**: Never perform manual AST string extraction, code transformations, or locale file writing directly. All logic is encapsulated in the `internationalize` MCP tool.
2. **Two-Stage Hybrid Intelligence**: Fast deterministic AST fast-pass categorizes the clear 90%. For ambiguous strings (`AMBIGUOUS`), the agent evaluates them and passes resolutions via `candidateDecisions`.
3. **Conservative Safety Defaults**: Always default to dry-run preview (`dryRun: true, apply: false, translate: false`). Never modify user files without explicit confirmation or `--apply`.
4. **Deterministic Idempotency**: If the project or scope is already internationalized, the MCP tool returns `NO_CHANGES`. Report this cleanly.
5. **Human-in-the-Loop**: Show proposed diffs and detected keys, then ask for confirmation before applying changes.

## Supported Invocations

### Slash Commands
- `/internationalize` — scans the entire project or default src scope.
- `/internationalize src/features/auth` — scopes to a specific feature directory.
- `/internationalize src/features/auth/LoginScreen.tsx` — scopes to a single screen or component.
- `/internationalize lib/screens/login.dart` — scopes to a Flutter Dart screen.
- `/internationalize src/features/auth src/features/profile` — scopes to multiple paths.
- `/internationalize src/features/auth --apply` — directly applies changes without waiting for preview confirmation.
- `/internationalize src/features/auth --apply --translate --target-locales=fr,es` — applies changes and translates to French and Spanish.

### Natural Language Requests
- *"Internationalize this screen"* $\rightarrow$ Scopes to the currently active or open screen file.
- *"Internationalize the auth module"* $\rightarrow$ Scopes to `src/features/auth`.
- *"Internationalize this feature"* $\rightarrow$ Scopes to the feature directory containing the active file.
- *"Find and replace all hardcoded user-facing strings in this folder"* $\rightarrow$ Scopes to the directory of the active file.
- *"Internationalize checkout and translate to French and Arabic"* $\rightarrow$ `scope: ['src/features/checkout']`, `translate: true`, `targetLocales: ['fr', 'ar']`.

## Tool Invocation

Call the MCP tool `internationalize`:
```json
{
  "ServerName": "react-native-i18n",
  "ToolName": "internationalize",
  "Arguments": {
    "scope": ["<target-paths>"],
    "dryRun": true,
    "apply": false,
    "translate": false
  }
}
```
If ambiguous candidates are present (`semanticRole: "AMBIGUOUS"`), resolve them via `candidateDecisions: { "<candidate-id>": true/false }`.
If the user confirms or `--apply` is present, re-run with `dryRun: false, apply: true`.
