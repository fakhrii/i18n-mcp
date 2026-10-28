# Multi-Framework i18n MCP Server (`i18n-mcp`)

Production-quality Model Context Protocol (MCP) server for automated internationalization across **React Native**, **React (web)**, **Next.js**, **Flutter**, and **Angular** projects.

Designed for AI coding agents (Antigravity, Claude Code, Cursor, Gemini CLI, etc.) to inspect projects, detect hardcoded user-facing strings with AST precision, understand existing i18n architectures, resolve ambiguous text candidates collaboratively, generate semantic translation keys, translate them, replace source code safely, and validate results.

---

## Supported Frameworks

| Framework | Language / AST | Detection & Text Sinks | i18n Libraries |
| :--- | :--- | :--- | :--- |
| **React Native** | TypeScript, TSX, JS, JSX | `<Text>`, `<TextInput>`, `Alert.alert`, `title`, `placeholder`, `accessibilityLabel` | `react-i18next`, `i18next` |
| **React (Web)** | TypeScript, TSX, JS, JSX | `<p>`, `<span>`, `<h1>-<h6>`, `<button>`, `<label>`, `placeholder`, `aria-label`, `window.alert` | `react-i18next`, `i18next` |
| **Next.js** | TypeScript, TSX, JS, JSX | React text tags, `<Link>`, metadata titles/descriptions, Pages & App Router | `next-intl`, `next-i18next`, `react-i18next` |
| **Flutter** | Dart | `Text()`, `SelectableText()`, `TextField(decoration:)`, `SnackBar()`, `AppBar(title:)` | `flutter_localizations`, `intl`, ARB |
| **Angular** | TypeScript, HTML | HTML templates (`.html` and inline), Angular Material (`mat-card-title`, `mat-hint`), `SnackBar.open()`, `title`, `placeholder`, `aria-label` | `@ngx-translate/core`, `@angular/localize`, `transloco` |
| **Vue / Nuxt** | TypeScript, JavaScript, Vue SFC | `<template>` text sinks, `router-link`, `nuxt-link`, `el-button`, `v-btn`, `title`, `placeholder`, `aria-label`, `toast` | `vue-i18n`, `@nuxtjs/i18n` |

---

## Key Principles & Innovations

- **Framework Adapters Architecture**: Decoupled core i18n engine with dedicated adapters (`IFrameworkAdapter`) that normalize component sinks, text props, feedback callees, and hook conventions per framework.
- **Two-Stage Hybrid String Detection**:
  - **Stage 1 (Deterministic AST Fast-Pass)**: Categorizes 90%+ strings with zero latency using the 4-Pillar classifier (Structural Text Sinks, Code Token Filtering, Inverted Non-Sink Default, Semantic Role Tagging). Obvious UI is marked `CONFIRMED_UI`; code tokens/styles/URLs are `CONFIRMED_TECHNICAL`; boundary cases are tagged `AMBIGUOUS`.
  - **Stage 2 (Agent Semantic Batch Resolution)**: Coding agents (or developers) inspect ambiguous candidates and provide structured decisions via `candidateDecisions: { [candidateId]: boolean }` to `generate_i18n_plan` or `internationalize`.
- **AST First, Regex Second**: Precision parsing of AST nodes rather than fragile regular expressions.
- **Safety First & Conservative Defaults**: Dry-run by default (`dryRun: true, apply: false`). Stale-plan protection with source SHA-256 hashes prevents accidental overwrites.
- **Human-in-the-Loop Orchestration**: Generates deterministic unified diff previews for review before disk mutations occur.

---

## MCP Tools

### `analyze_project`
Analyzes a project without modifying any files.
- **Inputs**: `projectPath` (string, optional)
- **Returns**:
  - `framework`: React Native / React / Next.js / Flutter / Unknown
  - `language`: TypeScript / JavaScript / Dart
  - `packageManager`: npm / yarn / pnpm / bun / flutter pub
  - `i18n`: Library (`react-i18next`, `next-intl`, `flutter_localizations`, etc.), locale directory, source and target locales, config file
  - `namespaces`: Existing and inferred namespaces
  - `projectStructure`: Feature and screen directory layout
  - `accessPatterns`: Detected hooks and translation functions (`useTranslation`, `t`, `i18n.t`, `Trans`, etc.)
  - `warnings`: Actionable warnings (missing target locales, inconsistent namespace files, malformed JSON/ARB)

### `scan_hardcoded_texts`
Scans a React Native project (as well as React, Next.js, and Flutter) or requested scope for hardcoded strings using AST analysis without modifying any files.
- **Inputs**:
  - `projectPath` (string, optional): Project root directory.
  - `scope` (string | string[], optional): Single file, directory, or glob pattern.
  - `include` / `exclude` (string[], optional): Custom inclusion/exclusion globs.
  - `onlyUserFacing` (boolean, optional, default `true`): If false, includes technical strings.
  - `minConfidence` (number, optional, default `0.0`): Confidence score filter (0.0 to 1.0).
  - `ambiguousOnly` (boolean, optional, default `false`): If true, returns only ambiguous strings requiring agent/human resolution.
- **Returns**:
  - Detections with `id` (`file:line:col`), `file`, `line`, `column`, `text`, `type`, `classification`, `confidence`, `semanticRole` (`CONFIRMED_UI`, `CONFIRMED_TECHNICAL`, `AMBIGUOUS`), `suggestedNamespace`, `suggestedKey`, and `variables`.

### `generate_i18n_plan`
Analyzes detected hardcoded strings and produces a complete, deterministic, reviewable i18n migration plan with zero filesystem mutations.
- **Inputs**:
  - `projectPath` / `scope` / `include` / `exclude`: Scope parameters.
  - `sourceLocale` / `targetLocales`: Locale settings.
  - `confidenceThreshold` (number, optional, default `0.7`): Minimum score for automatic replacement.
  - `includeAmbiguous` (boolean, optional, default `false`): Include ambiguous strings marked for review.
  - `candidateDecisions` (record, optional): Map of candidate ID or text to boolean decision (`true` = approve as user-facing, `false` = skip as technical).
- **Returns**: Complete `I18nPlan` including replacements, hook insertions, new translation keys, and source hashes.

### `apply_i18n_plan`
Safely and atomically applies an approved i18n migration plan to the project (React Native, React, Next.js, Flutter).
- **Inputs**:
  - `plan` or `planPath`: The approved `I18nPlan`.
  - `dryRun` (boolean, optional, default `false`): Calculates changes and returns diffs without modifying files.
  - `createBackup` (boolean, optional, default `false`): Creates `.bak` copies before writing changes.
  - `failOnWarnings` (boolean, optional, default `false`): Aborts if warnings exist.
- **Returns**: Applied changes summary, modified files list, and diff preview.

### `translate_i18n`
Translates missing keys across target locale files (JSON or Flutter ARB) using pluggable cloud translation providers (`deepl`, `openai`, `gemini`), built-in dictionaries, custom glossaries, or AI agent translations with **Context-Aware Prompting** without overwriting existing translations.
- **Inputs**:
  - `projectPath`: Project root directory.
  - `sourceLocale`, `targetLocales`: Locales to translate.
  - `namespaces`: Target namespaces to translate.
  - `provider` (`"auto"` | `"deepl"` | `"openai"` | `"gemini"` | `"dictionary"`, optional, default `"auto"`): Cloud translation provider. **Completely optional and non-blocking**; seamlessly falls back to offline dictionaries if unconfigured, offline, or timed out.
  - `apiKey` (string, optional): Cloud translation API key (or set `DEEPL_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` in environment).
  - `formality` (`"formal"` | `"informal"` | `"neutral"`, optional): Desired tone / grammatical formality (e.g. German "Sie" vs "du", French "vous" vs "tu", Spanish "usted" vs "tú").
  - `context` (object, optional): Explicit contextual clues including `role` ("BUTTON", "TITLE", "PLACEHOLDER"), `componentName`, `elementTag`, `propName`, `filePath`, `description`, `maxLength`, and `surroundingText`.
  - `glossary` (object, optional): Brand glossary containing `neverTranslate` brand terms and `terms` dictionary mappings.
  - `dryRun`: Preview translation changes without writing to disk.
  - `providedTranslations` (optional map of `{ [locale]: { [key]: translation } }`).
- **Context-Aware Intelligence**:
  - Automatically infers UI role classifications from key naming conventions (e.g. `*_BUTTON`, `*_TITLE`, `*_PLACEHOLDER`, `*_ERROR`, `*_TOOLTIP`, `*_NAV`).
  - Automatically extracts Flutter ARB `@key.description` translator notes to guide LLM disambiguation and parts of speech.
  - Injects structured context clues into OpenAI system prompts, Gemini instructions, and DeepL API context & formality parameters.

### `validate_i18n`
Validates i18n implementation for missing translations, interpolation variable mismatches, orphan keys, unused dead keys, and malformed files across JSON and ARB catalogs.
- **Inputs**: `projectPath`, `locales`, `namespaces`, `checkSourceCode`, `checkUnusedKeys`, `pruneUnusedKeys`, `scope`.

### `generate_i18n_types`
Generates compile-time TypeScript definitions (`resources.d.ts`) with module augmentation for i18next / react-i18next / next-intl from source locale catalogs, ensuring strict autocomplete and compile-time key safety.
- **Inputs**: `projectPath`, `outputPath` (default: `src/@types/resources.d.ts`), `writeToDisk` (boolean, default: `true`).

### `generate_pseudolocale`
Generates pseudo-localized catalogs (`qps-ploc`, `en-XA`, `qps-plocm` bidi) from source locale files for L10n stress-testing. Tests font glyph support, text expansion (+35%), UI layout clipping, and identifies hardcoded unextracted strings while safely preserving variables and HTML tags.
- **Inputs**: `projectPath`, `sourceLocale`, `targetLocale` (default: `"qps-ploc"`), `strategy` (`"accented"` | `"bidi"` | `"expansion"` | `"all"`), `expansionRatio` (default: `0.35`), `delimiter` (`"brackets"` | `"exclamation"` | `"none"`), `namespaces`, `dryRun`.

### `format_catalogs`
Cleans, sorts, and formats translation catalogs (JSON and ARB) alphabetically or aligned with source locale key ordering, eliminating merge conflicts and inconsistent indentation.
- **Inputs**: `projectPath`, `locales`, `namespaces`, `sortOrder` (`"alphabetical"` | `"align-with-source"`), `indent` (default: `2`), `dryRun`.

### `audit_rtl`
Audits codebase for Right-to-Left (RTL) and bidirectional layout bugs, detecting physical spacing (`marginLeft`/`marginRight`), alignment (`textAlign: left`), physical Tailwind utility classes (`ml-`, `mr-`, `text-left`), Flutter physical offsets (`EdgeInsets.only(left:)`, `Alignment.centerLeft`), directional icons, and missing RTL root configs, with automated logical property migration (`fix: true`).
- **Inputs**: `projectPath`, `scope`, `targetLocales` (e.g. `['ar', 'he']`), `fix` (boolean, default: `false`), `dryRun` (boolean, default: `true`).

### `audit_plurals`
Audits translation catalogs (JSON and Flutter ARB) against official Unicode CLDR plural and gender rules, detecting missing mandatory categories (e.g., Arabic `zero`/`two`/`few`/`many`, Russian `few`/`many`), missing mandatory `other` fallback branches, and variable mismatches, with automated scaffold fixing (`fix: true`).
- **Inputs**: `projectPath`, `locales` (e.g. `['ar', 'ru', 'pl']`), `namespaces`, `fix` (boolean, default: `false`), `dryRun` (boolean, default: `true`).

### `audit_formatting`
Audits project source code (React Native, React, Vue, Flutter, Next.js) for unlocalized formatting anti-patterns:
- **Hardcoded Currency Concatenation**: Flagging expressions like `` `$${price}` ``, `price + " €"`, and Flutter `'\$${item.price}'`, with automated migration to `Intl.NumberFormat` or Flutter `NumberFormat.simpleCurrency`.
- **Unlocalized Decimals**: Detects `.toFixed()` or `.toStringAsFixed()` where decimal points/commas depend on user locale.
- **Hardcoded Percentages**: Detects `` `${discount}%` `` and migrates to localized percentage formatting.
- **Unparameterized Date & Time**: Detects bare `.toLocaleDateString()` and `.toLocaleTimeString()` calls with automated migration to `Intl.DateTimeFormat(undefined, { dateStyle: "medium" })`.
- **Inputs**: `projectPath`, `scope`, `categories` (`CURRENCY`, `NUMBER`, `PERCENTAGE`, `DATE`, `TIME`), `fix` (boolean, default: `false`), `dryRun` (boolean, default: `true`).

### `export_translations`
Exports translation catalogs (JSON or Flutter ARB) into standard XLIFF (1.2 / 2.0) or TMX 1.4 exchange files for professional translation agencies and Translation Management Systems (Crowdin, Lokalise, Phrase, Smartling, Trados).
- **Inputs**: `projectPath`, `format` (`"xliff-1.2"` | `"xliff-2.0"` | `"tmx-1.4"`), `sourceLocale`, `targetLocales`, `namespaces`, `outputPath`, `includeNotes` (boolean, default `true`).

### `import_translations`
Imports translated strings from standard XLIFF (1.2 / 2.0) or TMX 1.4 exchange files back into project translation catalogs (JSON or Flutter ARB), with unified diff support and collision safety.
- **Inputs**: `projectPath`, `filePath`, `content`, `format`, `targetLocales`, `overwrite` (boolean, default `true`), `dryRun` (boolean, default `false`).

### `deduplicate_i18n`
Audits catalogs for exact duplicate keys, fuzzy near-duplicates, and cross-namespace redundancy using normalized Levenshtein similarity, with optional automated key consolidation and source code call-site updates.
- **Inputs**: `projectPath`, `sourceLocale`, `similarityThreshold` (number 0.5-1.0, default `0.85`), `exactOnly` (boolean), `crossNamespaceOnly` (boolean), `targetNamespace` (default `"common"`), `consolidate` (boolean, default `false`), `dryRun` (boolean, default `true`), `scope`.

### `internationalize`
End-to-end orchestration tool combining analysis, scanning, candidate resolution, planning, modification, translation, and validation into a unified workflow.
- **Inputs**:
  - `projectPath` (string, optional)
  - `scope` (string[], optional)
  - `dryRun` (boolean, optional, default `true`): Simulates execution and returns a unified diff.
  - `apply` (boolean, optional, default `false`): Applies code replacements and locale additions.
  - `translate` (boolean, optional, default `false`): Translates missing strings for target locales.
  - `provider` (`"auto"` | `"deepl"` | `"openai"` | `"gemini"` | `"dictionary"`, optional): Pluggable cloud translation provider with non-blocking fallback.
  - `apiKey` (string, optional): API key for cloud translation.
  - `providedTranslations` (record, optional): Agent-supplied translations for missing or ambiguous terms.
  - `candidateDecisions` (record, optional): Map of ambiguous candidate IDs to boolean approval.
  - `sourceLocale`, `targetLocales`, `namespaces`, `include`, `exclude`, `createBackup`.
- **Returns**: Full lifecycle report with status (`NO_CHANGES`, `PLAN_READY`, `APPLIED`, `APPLIED_WITH_WARNINGS`, `REVIEW_REQUIRED`, `FAILED`).

---

## ICU MessageFormat & Plural Parity

- **Flutter ARB**: Fully supports ICU plural syntax (`{count, plural, =0{no items} =1{1 item} other{{count} items}}`) with automated `@key.placeholders` metadata generation (`count: { type: "num", format: "compact" }`) required by `flutter gen-l10n`.
- **Next.js (`next-intl`)**: Generates single-key ICU MessageFormat plural definitions in message catalogs (`messages/*.json`).
- **React / React Native (`react-i18next`)**: Automatically produces `_one` and `_other` dual key entries for standard i18next runtime resolution.

---

## Layered Architecture

```text
src/
├── mcp/                      # Model Context Protocol layer
│   ├── server.ts             # McpServer instance & stdio lifecycle
│   └── tools/                # 8 registered MCP tools
│       ├── analyze-project.ts
│       ├── scan-hardcoded-texts.ts
│       ├── generate-i18n-plan.ts
│       ├── apply-i18n-plan.ts
│       ├── translate-i18n.ts
│       ├── validate-i18n.ts
│       ├── internationalize.ts
│       └── generate-i18n-types.ts
│
├── core/                     # Framework-independent i18n engine
│   ├── discovery/            # Project & framework detection
│   ├── scanner/              # AST string scanner
│   ├── classifier/           # 4-Pillar classification engine
│   ├── namespace/            # Namespace assignment
│   ├── keys/                 # Semantic key generation
│   ├── translation/          # Contextual translation service
│   ├── replacement/          # Safe source transformation
│   ├── validation/           # Completeness & consistency checks
│   ├── planning/             # Deterministic plan generation
│   └── orchestration/        # End-to-end pipeline coordinator
│
├── integrations/
│   └── adapters/             # Pluggable framework adapters
│       ├── framework-adapter.interface.ts
│       ├── react-native.adapter.ts
│       ├── react-web.adapter.ts
│       ├── nextjs.adapter.ts
│       └── flutter.adapter.ts
│
├── models/                   # Strongly-typed models and contracts
└── utils/                    # Safe file I/O and stderr logger
```

---

## Antigravity Agent Skill: `/internationalize`

The project includes an Antigravity Workspace Skill located at [`.agents/skills/internationalize/SKILL.md`](file:///.agents/skills/internationalize/SKILL.md) (and [`.claude/skills/internationalize/SKILL.md`](file:///.claude/skills/internationalize/SKILL.md)).

### Supported Commands & Invocations

```text
# Preview internationalization across the whole project (dry-run)
/internationalize

# Preview a specific feature directory
/internationalize src/features/auth

# Preview a single screen or component
/internationalize src/features/auth/LoginScreen.tsx

# Apply changes directly
/internationalize src/features/auth --apply

# Apply changes and generate French and Spanish translations
/internationalize src/features/auth --apply --translate --target-locales=fr,es
```

### Two-Stage Interactive Safety Workflow

1. Developer or Agent invokes `/internationalize src/features/auth`.
2. MCP scans the code and returns `PLAN_READY` with unified diff and any ambiguous candidates tagged `AMBIGUOUS`.
3. Agent quickly reviews ambiguous items (e.g. `<Button label="Save" />` $\rightarrow$ `true`) and passes resolutions via `candidateDecisions`.
4. Developer confirms *"apply"*.
5. Agent executes with `apply: true`, updating source code, creating locale keys, running translations, and validating results.

---

## Running the MCP Server

### Stdio Transport Configuration

Add the server to your MCP client configuration (Claude Desktop, Cursor, Gemini CLI, etc.):

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

## Development & Verification

```bash
# Build TypeScript
npm run build

# Run unit and integration tests (58 test files, 417 tests)
npm test

# Typecheck
npm run typecheck
```

---

## CLI Usage

For debugging and local development without an MCP client:

```bash
# Scan hardcoded strings in current project
npx i18n-mcp scan

# Scan specific project directory
npx i18n-mcp scan ./my-project

# Scan with scope (e.g. specific feature or file)
npx i18n-mcp scan ./my-project --scope src/features/auth

# Export catalogs to standard XLIFF (1.2 / 2.0) or TMX for translation agencies
npx i18n-mcp export ./my-project --format xliff-1.2 --target-locales fr es de --out ./exports

# Import translated XLIFF or TMX files back into catalogs
npx i18n-mcp import ./my-project --file ./exports/en_fr.xlf

# Audit catalogs for exact and fuzzy duplicate keys and consolidate redundancies
npx i18n-mcp dedupe ./my-project --threshold 0.85 --consolidate

# Audit and migrate unlocalized currency, number, percentage, and date formatting
npx i18n-mcp formatting ./my-project --categories CURRENCY NUMBER PERCENTAGE DATE --fix

# Audit and scaffold Unicode CLDR plural categories across catalogs
npx i18n-mcp plurals ./my-project --locales ar ru pl --fix

# Audit RTL layout and auto-fix physical properties to logical
npx i18n-mcp rtl ./my-project --target-locales ar he --fix

# Translate missing keys with context-aware formality
npx i18n-mcp translate ./my-project --target-locales fr es --formality formal --provider openai

# Generate TypeScript type definitions (resources.d.ts)
npx i18n-mcp types ./my-project

# Preview generated types without writing
npx i18n-mcp types ./my-project --dry-run

# Output raw JSON
npx i18n-mcp scan ./my-project --json
```
