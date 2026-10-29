import type { FrameworkType } from "../../models/project.js";
import type { FrameworkAdapter } from "./framework-adapter.interface.js";
import { ReactNativeAdapter } from "./react-native.adapter.js";
import { ReactWebAdapter } from "./react-web.adapter.js";
import { NextJsAdapter } from "./nextjs.adapter.js";
import { FlutterAdapter } from "./flutter.adapter.js";
import { AngularAdapter } from "./angular.adapter.js";
import { VueAdapter } from "./vue.adapter.js";
import { IosAdapter } from "./ios.adapter.js";
import { AndroidAdapter } from "./android.adapter.js";

export * from "./framework-adapter.interface.js";
export * from "./react-native.adapter.js";
export * from "./react-web.adapter.js";
export * from "./nextjs.adapter.js";
export * from "./flutter.adapter.js";
export * from "./angular.adapter.js";
export * from "./vue.adapter.js";
export * from "./ios.adapter.js";
export * from "./android.adapter.js";

const adapters: Record<FrameworkType, FrameworkAdapter> = {
  "react-native": new ReactNativeAdapter(),
  react: new ReactWebAdapter(),
  nextjs: new NextJsAdapter(),
  flutter: new FlutterAdapter(),
  angular: new AngularAdapter(),
  vue: new VueAdapter(),
  ios: new IosAdapter(),
  android: new AndroidAdapter(),
  unknown: new ReactNativeAdapter(),
};

export function getFrameworkAdapter(framework: FrameworkType): FrameworkAdapter {
  return adapters[framework] ?? adapters["unknown"];
}
