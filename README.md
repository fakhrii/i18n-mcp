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
