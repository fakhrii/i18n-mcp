import * as path from "node:path";
import type { I18nMcpConfig } from "../models/config.js";
import { fileExists, readJsonFile } from "../utils/file-system.js";
import { logger } from "../utils/logger.js";

export const CONFIG_FILE_NAME = "i18n-mcp.config.json";

export async function loadProjectConfig(projectRoot: string): Promise<I18nMcpConfig | null> {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  if (!(await fileExists(configPath))) {
    return null;
  }

  try {
    const config = await readJsonFile<I18nMcpConfig>(configPath);
    if (!config) {
      logger.warn(`Config file found at ${configPath} but could not be parsed.`);
      return null;
    }
    logger.debug(`Loaded config from ${configPath}`, config);
    return config;
  } catch (error) {
    logger.error(`Error loading config from ${configPath}:`, error);
    return null;
  }
}
