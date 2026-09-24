# React Native i18n MCP Server (`i18n-mcp`)

Production-quality Model Context Protocol (MCP) server for automatic internationalization of React Native projects.

Designed for AI coding agents (Claude Code, Cursor, Gemini CLI, etc.) to inspect React Native projects, detect hardcoded user-facing strings, understand i18n architecture, generate semantic translation keys, translate them, replace strings safely, and validate results.

## Key Principles

- **AST First, Regex Second**: Precision parsing of JSX, TSX, and TS AST nodes.
- **Discover Before Modifying**: Deep analysis of project structure, existing i18n configs, namespaces, and code patterns before changes.
- **Safety and Minimal Changes**: Never modify files blindly; generate deterministic plans first.
- **Decoupled Architecture**: Framework-independent core i18n engine with framework-specific adapters.

---

## MCP Tools

### `analyze_project`
Analyzes a project without modifying any files.
- **Inputs**: `projectPath` (string, optional)
- **Returns**:
  - `framework`: React Native / React / Unknown
  - `language`: TypeScript / JavaScript
  - `packageManager`: npm / yarn / pnpm / bun
  - `i18n`: Library (`react-i18next`, `i18next`, etc.), locale directory, source and target locales, config file
  - `namespaces`: Existing and inferred namespaces
  - `projectStructure`: Feature and screen directory layout
  - `accessPatterns`: Detected hooks and translation functions (`useTranslation`, `t`, `i18n.t`, `Trans`)
  - `warnings`: Actionable warnings (missing target locales, inconsistent namespace files, malformed JSON)

### `scan_hardcoded_texts`
Scans a React Native project or requested scope for hardcoded user-facing strings using AST analysis. Does NOT modify any files.
- **Inputs**:
  - `projectPath` (string, optional): Project root directory.
  - `scope` (string | string[], optional): Single file, directory, or glob pattern.
  - `include` (string[], optional): Custom inclusion globs.
  - `exclude` (string[], optional): Custom exclusion globs.
  - `onlyUserFacing` (boolean, optional, default `true`): If false, includes technical strings.
  - `minConfidence` (number, optional, default `0.0`): Confidence score filter (0.0 to 1.0).
- **Returns**:
  - `total`: Total strings detected
  - `userFacingCount`: Number of user-facing strings
  - `technicalCount`: Number of technical strings
  - `items`: Array of detections with:
    - `file`, `line`, `column`, `endLine`, `endColumn`
    - `text`, `rawText`, `type` (`JSX_TEXT`, `JSX_ATTRIBUTE`, `CALL_EXPRESSION`, `OBJECT_PROPERTY`, `TEMPLATE_LITERAL`, etc.)
    - `classification` (`UI_TEXT`, `BUTTON`, `PLACEHOLDER`, `ACCESSIBILITY`, `NOTIFICATION`, `ERROR_MESSAGE`, etc.)
    - `confidence` (0.00 - 1.00) and `confidenceLevel` (`HIGH`, `MEDIUM`, `LOW`)
    - `suggestedNamespace` and `suggestedKey` (UPPER_SNAKE_CASE)
    - `reason`: Contextual explanation
    - `variables`: Extracted interpolation placeholders for template literals (e.g. `{{name}}`)

---

## Layered Architecture

```text
src/
├── mcp/                      # Model Context Protocol layer
│   ├── server.ts             # McpServer instance & stdio lifecycle
│   └── tools/                # MCP tool handlers
│       ├── index.ts
│       └── analyze-project.ts
│
├── core/                     # Framework-independent i18n engine
│   ├── discovery/            # Project, i18n, and feature discovery
│   ├── scanner/              # AST string scanner (Phase 3)
│   ├── classifier/           # String classification & confidence (Phase 4)
│   ├── namespace/            # Namespace assignment (Phase 6)
│   ├── keys/                 # Semantic key generation (Phase 7)
│   ├── translation/          # Contextual translation engine (Phase 10)
│   ├── replacement/          # Safe source transformation (Phase 9)
│   ├── validation/           # Verification & consistency checks (Phase 11)
│   ├── planning/             # Deterministic plan generation (Phase 8)
│   └── scope/                # Path filtering and scoping (Phase 8)
│
├── parsers/                  # Framework/language specific parsers
│   ├── typescript/
│   └── tsx/
│
├── integrations/             # Library adapters
│   ├── i18next/
│   └── react-i18next/
│
├── config/                   # Configuration loader (i18n-mcp.config.json)
├── models/                   # Strongly-typed models and structured errors
└── utils/                    # Safe file I/O, logger (stderr safe)
```

### `internationalize`
End-to-end orchestration tool combining analysis, scanning, planning, modification, translation, and validation into a unified workflow.
- **Conservative Defaults**: Runs in dry-run mode (`dryRun: true, apply: false, translate: false`) unless explicitly requested otherwise.
- **Inputs**:
  - `projectPath` (string, optional): Project root directory.
  - `scope` (string[], optional): Files or directories to process.
  - `dryRun` (boolean, optional, default `true`): Simulates execution and returns a unified diff preview.
  - `apply` (boolean, optional, default `false`): Applies code replacements and locale additions.
  - `translate` (boolean, optional, default `false`): Translates missing strings for target locales.
  - `sourceLocale` (string, optional): Source locale (e.g. `en`).
  - `targetLocales` (string[], optional): Target locales (e.g. `['fr', 'es']`).
  - `createBackup` (boolean, optional, default `false`): Creates `.bak` files before modifying disk.
  - `failOnWarnings` (boolean, optional, default `false`): Halts on warnings.
- **Returns**: Complete structured report with status (`NO_CHANGES`, `PLAN_READY`, `APPLIED`, `APPLIED_WITH_WARNINGS`, `REVIEW_REQUIRED`, `FAILED`, `FAILED_VALIDATION`), scanned metrics, generated keys, unified diff, translation stats, and validation issues.

---

## Antigravity Agent Skill: `/internationalize`

The project includes an Antigravity Workspace Skill located at [`.agents/skills/internationalize/SKILL.md`](file:///.agents/skills/internationalize/SKILL.md) (and [`.claude/skills/internationalize/SKILL.md`](file:///.claude/skills/internationalize/SKILL.md)).

The skill acts as a thin agent UX layer delegating directly to the `internationalize` MCP orchestrator tool.

### Supported Slash Commands

```text
# Preview internationalization across the whole project (dry-run)
/internationalize

# Preview a specific feature directory
/internationalize src/features/auth

# Preview a single screen or component
/internationalize src/features/auth/LoginScreen.tsx

# Preview multiple paths
/internationalize src/features/auth src/features/profile

# Apply changes directly
/internationalize src/features/auth --apply

# Apply changes and generate French and Spanish translations
/internationalize src/features/auth --apply --translate --target-locales=fr,es
```

### Supported Natural Language Invocations

- *"Internationalize this screen"* — infers scope from the active editor screen file.
- *"Internationalize the auth module"* — scopes to `src/features/auth`.
- *"Internationalize this feature"* — infers feature directory from active editor file.
- *"Find and replace all hardcoded user-facing strings in this folder"* — scopes to the active directory.
- *"Internationalize checkout and translate to French and Arabic"* — scopes to `src/features/checkout`, sets `translate: true` and `targetLocales: ['fr', 'ar']`.

### Interactive Safety Workflow

1. Developer invokes `/internationalize src/features/auth`.
2. Agent executes MCP `internationalize({ scope: ['src/features/auth'], dryRun: true, apply: false })`.
3. Agent outputs a structured summary table, candidate translation keys, and unified diff preview.
4. Agent prompts: *"The plan is ready. No files have been modified. To apply these changes, run `/internationalize src/features/auth --apply` or reply **apply**."*
5. Developer replies *"apply"*.
6. Agent applies changes, updates locale JSON files, runs translations (if requested), validates results, and prints the final report.

---

## CLI Usage

For debugging and local development without an MCP client:

```bash
# Scan hardcoded strings in current project
npx i18n-mcp scan

# Scan specific project directory
npx i18n-mcp scan ./my-react-native-app

# Scan with scope (e.g. specific feature or file)
npx i18n-mcp scan ./my-react-native-app --scope src/features/auth

# Output raw JSON
npx i18n-mcp scan ./my-react-native-app --json
```

---

## Running MCP Server

### Stdio Transport

Configure your MCP client (e.g., Claude Desktop, Cursor, Gemini CLI) with:

```json
{
  "mcpServers": {
    "react-native-i18n": {
      "command": "node",
      "args": ["<path-to-i18n-mcp>/dist/mcp/server.js"]
    }
  }
}
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Typecheck
npm run typecheck

# Build TypeScript
npm run build
```
