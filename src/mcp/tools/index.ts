import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAnalyzeProjectTool } from "./analyze-project.js";
import { registerScanHardcodedTextsTool } from "./scan-hardcoded-texts.js";
import { registerGenerateI18nPlanTool } from "./generate-i18n-plan.js";
import { registerApplyI18nPlanTool } from "./apply-i18n-plan.js";
import { registerTranslateI18nTool } from "./translate-i18n.js";
import { registerValidateI18nTool } from "./validate-i18n.js";
import { registerInternationalizeTool } from "./internationalize.js";
import { registerGenerateI18nTypesTool } from "./generate-i18n-types.js";
import { registerGeneratePseudolocaleTool } from "./generate-pseudolocale.js";
import { registerFormatCatalogsTool } from "./format-catalogs.js";
import { registerAuditRtlTool } from "./audit-rtl.js";

export function registerAllTools(server: McpServer): void {
  registerAnalyzeProjectTool(server);
  registerScanHardcodedTextsTool(server);
  registerGenerateI18nPlanTool(server);
  registerApplyI18nPlanTool(server);
  registerTranslateI18nTool(server);
  registerValidateI18nTool(server);
  registerInternationalizeTool(server);
  registerGenerateI18nTypesTool(server);
  registerGeneratePseudolocaleTool(server);
  registerFormatCatalogsTool(server);
  registerAuditRtlTool(server);
}

export * from "./analyze-project.js";
export * from "./scan-hardcoded-texts.js";
export * from "./generate-i18n-plan.js";
export * from "./apply-i18n-plan.js";
export * from "./translate-i18n.js";
export * from "./validate-i18n.js";
export * from "./internationalize.js";
export * from "./generate-i18n-types.js";
export * from "./generate-pseudolocale.js";
export * from "./format-catalogs.js";
export * from "./audit-rtl.js";
