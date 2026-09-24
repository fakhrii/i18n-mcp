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

---

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

---

## Agent Execution Steps

### Step 1: Parse User Input and Scope
Determine the arguments:
- **`scope`**: List of paths or directories specified by the user or inferred from context.
- **`apply`**: `true` if user supplied `--apply` or confirmed previous dry run; otherwise `false`.
- **`dryRun`**: `false` if `apply === true`; otherwise `true`.
- **`translate`**: `true` if user supplied `--translate` or mentioned translating; otherwise `false`.
- **`targetLocales`**: Array of locale codes (e.g. `['fr', 'es']`) if specified in flags or natural language.

### Step 2: Invoke the `internationalize` MCP Tool (Dry Run)
Call the MCP tool:
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

### Step 3: Semantic Ambiguity Resolution (Stage 2)
If the scan or plan contains items with `semanticRole: "AMBIGUOUS"`:
- Inspect the candidates:
  - UI labels / actions (e.g. `<Button action="Save" />`) $\rightarrow$ Approve (`true`).
  - Technical tokens / IDs / styles (e.g. `mode="dark"`) $\rightarrow$ Skip (`false`).
- Bundle decisions into `candidateDecisions: { "<candidate-id>": true/false }` for subsequent calls.

### Step 4: Present Results to Developer
Format the MCP response into clean Markdown:
- **If `status: "NO_CHANGES"`**:
  Inform the developer:
  > ✅ **Codebase Already Internationalized**: No hardcoded user-facing strings were detected in the requested scope.
- **If `status: "PLAN_READY"`**:
  Display:
  1. Summary Table: User-facing strings detected, technical strings skipped, proposed key count.
  2. Ambiguous Candidates Resolved: List any decisions made in Stage 2.
  3. Diff Preview: Unified diff of source code and locale file changes.
  4. Call to Action:
     > ⚠️ **Dry-run**: No files have been modified.
     > To apply these changes, run `/internationalize <scope> --apply` or reply **"apply"**.
- **If `status: "APPLIED"` or `"APPLIED_WITH_WARNINGS"`**:
  Display list of modified files, translation counts, and validation results.
- **If `status: "REVIEW_REQUIRED"`**:
  Highlight specific strings requiring human judgment before automated migration.

### Step 5: Apply on User Confirmation
If the developer replies with confirmation (e.g. "apply", "proceed", "yes, apply"):
Re-invoke the MCP tool with:
```json
{
  "ServerName": "react-native-i18n",
  "ToolName": "internationalize",
  "Arguments": {
    "scope": ["<target-paths>"],
    "dryRun": false,
    "apply": true,
    "translate": <translateRequested>,
    "candidateDecisions": <resolvedDecisionsIfAny>
  }
}
```
Present the final applied report and validation results.
