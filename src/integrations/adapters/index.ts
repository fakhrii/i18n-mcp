import type { FrameworkType } from "../../models/project.js";
import type { FrameworkAdapter } from "./framework-adapter.interface.js";
import { ReactNativeAdapter } from "./react-native.adapter.js";
import { ReactWebAdapter } from "./react-web.adapter.js";
import { NextJsAdapter } from "./nextjs.adapter.js";
import { FlutterAdapter } from "./flutter.adapter.js";

export * from "./framework-adapter.interface.js";
export * from "./react-native.adapter.js";
export * from "./react-web.adapter.js";
export * from "./nextjs.adapter.js";
export * from "./flutter.adapter.js";

const adapters: Record<FrameworkType, FrameworkAdapter> = {
  "react-native": new ReactNativeAdapter(),
  react: new ReactWebAdapter(),
  nextjs: new NextJsAdapter(),
  flutter: new FlutterAdapter(),
  unknown: new ReactNativeAdapter(),
};

export function getFrameworkAdapter(framework: FrameworkType): FrameworkAdapter {
  return adapters[framework] ?? adapters["unknown"];
}
