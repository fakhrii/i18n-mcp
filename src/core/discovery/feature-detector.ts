import * as path from "node:path";
import type { ProjectStructure } from "../../models/project.js";
import { dirExists, listDirectories, toPosixPath } from "../../utils/file-system.js";

const FEATURE_DIR_CANDIDATES = [
  "src/features",
  "features",
  "src/modules",
  "modules",
  "src/domains",
  "domains",
];

const SCREEN_DIR_CANDIDATES = [
  "src/screens",
  "screens",
  "src/pages",
  "pages",
  "src/views",
  "views",
];

export async function detectProjectStructure(projectRoot: string): Promise<ProjectStructure> {
  let featureDirectory: string | undefined;
  let features: string[] = [];

  for (const candidate of FEATURE_DIR_CANDIDATES) {
    const fullPath = path.join(projectRoot, candidate);
    if (await dirExists(fullPath)) {
      featureDirectory = toPosixPath(candidate);
      const subdirs = await listDirectories(fullPath);
      features = subdirs.filter((name) => !name.startsWith(".") && name !== "components" && name !== "utils");
      break;
    }
  }

  let screenDirectory: string | undefined;
  let screens: string[] = [];

  for (const candidate of SCREEN_DIR_CANDIDATES) {
    const fullPath = path.join(projectRoot, candidate);
    if (await dirExists(fullPath)) {
      screenDirectory = toPosixPath(candidate);
      const subdirs = await listDirectories(fullPath);
      screens = subdirs.filter((name) => !name.startsWith("."));
      break;
    }
  }

  return {
    ...(featureDirectory ? { featureDirectory } : {}),
    features: features.sort(),
    ...(screenDirectory ? { screenDirectory } : {}),
    screens: screens.sort(),
  };
}
