import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export const SKILL_CONTENT = `---
name: internationalize
description: >-
  Internationalize React Native, React (web), Next.js, Flutter, or Angular projects, features, screens, or components using the i18n MCP server.
  Use when the user invokes /internationalize or asks to extract hardcoded strings, translate text,
  or internationalize a module.
---

# Multi-Framework Internationalization Skill (\`/internationalize\`)

This skill orchestrates the end-to-end internationalization pipeline across **React Native**, **React (web)**, **Next.js**, **Flutter**, and **Angular** projects by delegating directly to the MCP tool \`internationalize\`.

## Core Principles

1. **Thin Agent UX Layer**: Never perform manual AST string extraction, code transformations, or locale file writing directly. All logic is encapsulated in the \`internationalize\` MCP tool.
2. **Two-Stage Hybrid Intelligence**: Fast deterministic AST fast-pass categorizes the clear 90%. For ambiguous strings (\`AMBIGUOUS\`), the agent evaluates them and passes resolutions via \`candidateDecisions\`.
3. **Conservative Safety Defaults**: Always default to dry-run preview (\`dryRun: true, apply: false, translate: false\`). Never modify user files without explicit confirmation or \`--apply\`.
4. **Deterministic Idempotency**: If the project or scope is already internationalized, the MCP tool returns \`NO_CHANGES\`. Report this cleanly.
5. **Human-in-the-Loop**: Show proposed diffs and detected keys, then ask for confirmation before applying changes.

---

## Supported Invocations

### Slash Commands
- \`/internationalize\` — scans the entire project or default src scope.
- \`/internationalize src/features/auth\` — scopes to a specific feature directory.
- \`/internationalize src/features/auth/LoginScreen.tsx\` — scopes to a single screen or component.
- \`/internationalize src/app/login/login.component.html\` — scopes to an Angular component template.
- \`/internationalize lib/screens/login.dart\` — scopes to a Flutter Dart screen.
- \`/internationalize src/features/auth src/features/profile\` — scopes to multiple paths.
- \`/internationalize src/features/auth --apply\` — directly applies changes without waiting for preview confirmation.
- \`/internationalize src/features/auth --apply --translate --target-locales=fr,es\` — applies changes and translates to French and Spanish.

### Natural Language Requests
- *"Internationalize this screen"* → Scopes to the currently active or open screen file.
- *"Internationalize the auth module"* → Scopes to \`src/features/auth\`.
- *"Internationalize this feature"* → Scopes to the feature directory containing the active file.
- *"Find and replace all hardcoded user-facing strings in this folder"* → Scopes to the directory of the active file.
- *"Internationalize checkout and translate to French and Arabic"* → \`scope: ['src/features/checkout']\`, \`translate: true\`, \`targetLocales: ['fr', 'ar']\`.
- *"Internationalize using nested structure"* → \`structure: 'nested'\`.

---

## Automatic Structure Detection (\`structureType\`)

The migration engine automatically detects your codebase's i18n architectural pattern:
- **\`"nested"\` (Single-file hierarchical JSON)**: Single file per locale (e.g. \`locales/en.json\`) with nested objects (\`{ "auth": { "login": "..." }, "common": { "save": "..." } }\`).
  - Components invoke: \`const { t } = useTranslation();\` (no namespace arguments).
  - Keys referenced via dot notation: \`t("auth.login")\` and \`t("common.save")\` (never colons).
  - All translations are placed hierarchically into \`locales/en.json\`.
- **\`"namespaces"\` (Multi-file namespace bundles)**: Separate JSON files per namespace (e.g. \`locales/en/common.json\`, \`locales/en/auth.json\`).
  - Components invoke: \`const { t } = useTranslation(["auth", "common"]);\`
  - Primary namespace keys: \`t("login")\`; secondary namespace keys: \`t("common:save")\` (with colon).
  - Translations are written to separate \`locales/en/<namespace>.json\` files.
- **\`"flat"\` (Flat single-file JSON or Flutter ARB)**: Flat dictionary without nesting (e.g. \`locales/en.json\` or \`lib/l10n/app_en.arb\`).
  - Keys referenced directly: \`t("login")\`.

Can be explicitly overridden via \`--structure=nested\`, \`--structure=namespaces\`, or \`--structure=flat\`.

---

## Agent Execution Steps

### Step 1: Parse User Input and Scope
Determine the arguments:
- **\`scope\`**: List of paths or directories specified by the user or inferred from context.
- **\`apply\`**: \`true\` if user supplied \`--apply\` or confirmed previous dry run; otherwise \`false\`.
- **\`dryRun\`**: \`false\` if \`apply === true\`; otherwise \`true\`.
- **\`translate\`**: \`true\` if user supplied \`--translate\` or mentioned translating; otherwise \`false\`.
- **\`targetLocales\`**: Array of locale codes (e.g. \`['fr', 'es']\`) if specified in flags or natural language.

### Step 2: Invoke the \`internationalize\` MCP Tool (Dry Run)
Call the MCP tool:
\`\`\`json
{
  "ServerName": "i18n-mcp",
  "ToolName": "internationalize",
  "Arguments": {
    "scope": ["<target-paths>"],
    "dryRun": true,
    "apply": false,
    "translate": false
  }
}
\`\`\`

### Step 3: Semantic Ambiguity Resolution (Stage 2)
If the scan or plan contains items with \`semanticRole: "AMBIGUOUS"\`:
- Inspect the candidates:
  - UI labels / actions (e.g. \`<Button action="Save" />\`) → Approve (\`true\`).
  - Technical tokens / IDs / styles (e.g. \`mode="dark"\`) → Skip (\`false\`).
  - Mock data / test fixtures / dummy samples (e.g. \`const MOCK_ITEMS = ...\`, sample data, fixtures) → Skip (\`false\`). Never extract or translate mock data!
- Bundle decisions into \`candidateDecisions: { "<candidate-id>": true/false }\` for subsequent calls.

### Step 4: Present Results to Developer
Format the MCP response into clean Markdown:
- **If \`status: "NO_CHANGES"\`**:
  Inform the developer:
  > ✅ **Codebase Already Internationalized**: No hardcoded user-facing strings were detected in the requested scope.
- **If \`status: "PLAN_READY"\`**:
  Display:
  1. Summary Table: User-facing strings detected, technical strings skipped, proposed key count.
  2. Ambiguous Candidates Resolved: List any decisions made in Stage 2.
  3. Diff Preview: Unified diff of source code and locale file changes.
  4. Call to Action:
     > ⚠️ **Dry-run**: No files have been modified.
     > To apply these changes, run \`/internationalize <scope> --apply\` or reply **"apply"**.
- **If \`status: "APPLIED"\` or \`"APPLIED_WITH_WARNINGS"\`**:
  Display list of modified files, translation counts, and validation results.
- **If \`status: "REVIEW_REQUIRED"\`**:
  Highlight specific strings requiring human judgment before automated migration.

### Step 5: Apply on User Confirmation & Translation Providers
If the developer replies with confirmation (e.g. "apply", "proceed", "yes, apply"):
The tool supports optional cloud translation providers (\`deepl\`, \`openai\`, \`gemini\`) which are **non-blocking** (seamlessly falling back to local offline dictionaries if keys are not provided or network fails), as well as direct agent-provided translations via \`providedTranslations\`:
\`\`\`json
{
  "ServerName": "i18n-mcp",
  "ToolName": "internationalize",
  "Arguments": {
    "scope": ["<target-paths>"],
    "dryRun": false,
    "apply": true,
    "translate": <translateRequested>,
    "provider": "auto",
    "candidateDecisions": <resolvedDecisionsIfAny>,
    "providedTranslations": {
      "es": { "customTerm": "Término personalizado" },
      "fr": { "customTerm": "Terme personnalisé" }
    }
  }
}
\`\`\`
Present the final applied report and validation results.

### ICU MessageFormat & Plural Support
- **Flutter ARB**: Generates ICU plurals (\`{count, plural, =0{...} =1{...} other{...}}\`) with automated \`@key.placeholders\` metadata (\`count: { type: "num", format: "compact" }\`).
- **Next.js (\`next-intl\`)**: Generates single-key ICU MessageFormat plural definitions in \`messages/*.json\`.
- **React / React Native (\`react-i18next\`)**: Generates \`_one\` and \`_other\` dual keys for standard runtime resolution.

### Step 6: Generate TypeScript Typings (TypeScript Projects)
If the project is a TypeScript project with \`i18next\` / \`react-i18next\` / \`next-intl\`, invoke \`generate_i18n_types\` (or recommend \`npx i18n-mcp types\`) to create or update \`src/@types/resources.d.ts\` for full compile-time key validation.

---

## Reverting Changes or Excluding Mock Data

If the developer indicates that mock data, dummy text, or unwanted files were modified:

1. **Reverting Changes via Git**:
   - Revert modified files: \`git checkout -- <file>\` or \`git restore <file>\`
   - Revert entire directory: \`git restore <directory>\`
2. **Reverting Changes via Backup (\`createBackup: true\`)**:
   - Restore the \`.bak\` file created next to the modified source file (e.g. \`cp src/Screen.tsx.bak src/Screen.tsx\`).
3. **Excluding Mock Files on Next Run**:
   - Pass explicit exclusions to the tool:
     \`--exclude="**/mocks/**,**/*.mock.*,**/fixtures/**,**/*.stories.*"\`
   - Or target the specific component file directly rather than a broad folder:
     \`/internationalize src/screens/HomeScreen.tsx\`
`;

export const MCP_SERVER_CONFIG = {
  command: "npx",
  args: ["-y", "@fakhrii/i18n-mcp", "serve"],
};

export interface InitOptions {
  global?: boolean;
  client?: "all" | "antigravity" | "claude" | "cursor";
  force?: boolean;
}

export async function runInit(targetDir: string, options: InitOptions = {}): Promise<void> {
  const isGlobal = !!options.global;
  const client = options.client || "all";
  const force = !!options.force;

  console.log(`\nInitializing i18n-mcp (${isGlobal ? "Global" : "Project"} Mode)...\n`);

  const createdFiles: string[] = [];
  const updatedConfigs: string[] = [];

  // Helper to ensure directory and write file
  async function safeWriteFile(filePath: string, content: string): Promise<boolean> {
    try {
      if (!force) {
        try {
          await fs.access(filePath);
          // File exists
          return false;
        } catch {
          // File doesn't exist, proceed
        }
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return true;
    } catch (err) {
      console.error(`  [!] Failed to write ${filePath}:`, (err as Error).message);
      return false;
    }
  }

  // Helper to merge MCP server entry into a JSON config file
  async function mergeMcpConfig(configPath: string): Promise<boolean> {
    try {
      let config: any = { mcpServers: {} };
      try {
        const text = await fs.readFile(configPath, "utf-8");
        config = JSON.parse(text);
        if (!config.mcpServers) config.mcpServers = {};
      } catch {
        // Create fresh
      }

      config.mcpServers["i18n-mcp"] = MCP_SERVER_CONFIG;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      return true;
    } catch (err) {
      console.error(`  [!] Failed to update config ${configPath}:`, (err as Error).message);
      return false;
    }
  }

  if (isGlobal) {
    const home = os.homedir();

    // 1. Antigravity Global Skill
    if (client === "all" || client === "antigravity") {
      const globalSkillPath = path.join(home, ".gemini", "config", "skills", "internationalize", "SKILL.md");
      if (await safeWriteFile(globalSkillPath, SKILL_CONTENT)) {
        createdFiles.push(globalSkillPath);
      }

      const globalMcpConfig = path.join(home, ".gemini", "config", "mcp_config.json");
      if (await mergeMcpConfig(globalMcpConfig)) {
        updatedConfigs.push(globalMcpConfig);
      }
    }

    // 2. Claude Desktop Global Config
    if (client === "all" || client === "claude") {
      const claudeConfigPath =
        process.platform === "win32"
          ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
          : path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

      if (await mergeMcpConfig(claudeConfigPath)) {
        updatedConfigs.push(claudeConfigPath);
      }
    }
  } else {
    const root = path.resolve(targetDir);

    // 1. Antigravity / Gemini CLI Project Skill
    if (client === "all" || client === "antigravity") {
      const agySkillPath = path.join(root, ".agents", "skills", "internationalize", "SKILL.md");
      if (await safeWriteFile(agySkillPath, SKILL_CONTENT)) {
        createdFiles.push(agySkillPath);
      }
    }

    // 2. Claude Code Project Skill
    if (client === "all" || client === "claude") {
      const claudeSkillPath = path.join(root, ".claude", "skills", "internationalize", "SKILL.md");
      if (await safeWriteFile(claudeSkillPath, SKILL_CONTENT)) {
        createdFiles.push(claudeSkillPath);
      }
    }

    // 3. Cursor MCP Config
    if (client === "all" || client === "cursor") {
      const cursorConfigPath = path.join(root, ".cursor", "mcp.json");
      if (await mergeMcpConfig(cursorConfigPath)) {
        updatedConfigs.push(cursorConfigPath);
      }
    }
  }

  // Summary output
  console.log("Installation Summary:");
  if (createdFiles.length > 0) {
    console.log("  Created Skills:");
    for (const f of createdFiles) {
      console.log(`    + ${f}`);
    }
  } else {
    console.log("  Skills already exist (use --force to overwrite).");
  }

  if (updatedConfigs.length > 0) {
    console.log("  Configured MCP Servers:");
    for (const c of updatedConfigs) {
      console.log(`    ✓ ${c}`);
    }
  }

  console.log("\nSetup Complete!");
  console.log("You can now open your AI agent (Antigravity, Claude, Cursor) and use:");
  console.log("  - /internationalize (slash command)");
  console.log('  - Or ask: "Scan my project for hardcoded strings and internationalize them"\n');
}
