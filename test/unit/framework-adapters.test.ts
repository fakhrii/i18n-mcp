import { describe, it, expect } from "vitest";
import {
  getFrameworkAdapter,
  ReactNativeAdapter,
  ReactWebAdapter,
  NextJsAdapter,
  FlutterAdapter,
  AngularAdapter,
} from "../../src/integrations/adapters/index.js";

describe("Framework Adapters & Multi-Framework Registry", () => {
  it("resolves the correct adapter for each framework type", () => {
    expect(getFrameworkAdapter("react-native")).toBeInstanceOf(ReactNativeAdapter);
    expect(getFrameworkAdapter("react")).toBeInstanceOf(ReactWebAdapter);
    expect(getFrameworkAdapter("nextjs")).toBeInstanceOf(NextJsAdapter);
    expect(getFrameworkAdapter("flutter")).toBeInstanceOf(FlutterAdapter);
    expect(getFrameworkAdapter("angular")).toBeInstanceOf(AngularAdapter);
    expect(getFrameworkAdapter("unknown")).toBeInstanceOf(ReactNativeAdapter);
  });

  describe("React Native Adapter", () => {
    const adapter = new ReactNativeAdapter();

    it("identifies React Native text components", () => {
      expect(adapter.isKnownTextComponent("Text")).toBe(true);
      expect(adapter.isKnownTextComponent("Animated.Text")).toBe(true);
      expect(adapter.isKnownTextComponent("CustomText")).toBe(true);
      expect(adapter.isKnownTextComponent("View")).toBe(false);
    });

    it("identifies React Native text props and feedback calls", () => {
      expect(adapter.isKnownTextProp("title")).toBe(true);
      expect(adapter.isKnownTextProp("placeholder")).toBe(true);
      expect(adapter.isKnownTextProp("accessibilityLabel")).toBe(true);
      expect(adapter.isKnownTextProp("resizeMode")).toBe(false);

      expect(adapter.isKnownFeedbackCall("Alert.alert")).toBe(true);
      expect(adapter.isKnownFeedbackCall("showToast")).toBe(true);
      expect(adapter.isKnownFeedbackCall("console.log")).toBe(false);
    });
  });

  describe("React (Web) Adapter", () => {
    const adapter = new ReactWebAdapter();

    it("identifies Web semantic HTML text elements", () => {
      expect(adapter.isKnownTextComponent("p")).toBe(true);
      expect(adapter.isKnownTextComponent("span")).toBe(true);
      expect(adapter.isKnownTextComponent("h1")).toBe(true);
      expect(adapter.isKnownTextComponent("div")).toBe(false);
    });

    it("identifies ARIA text props and attributes", () => {
      expect(adapter.isKnownTextProp("aria-label")).toBe(true);
      expect(adapter.isKnownTextProp("alt")).toBe(true);
      expect(adapter.isKnownTextProp("placeholder")).toBe(true);
      expect(adapter.isKnownTextProp("className")).toBe(false);
    });
  });

  describe("Next.js Adapter", () => {
    const adapter = new NextJsAdapter();

    it("provides Next.js translation pattern", () => {
      const pattern = adapter.getDefaultTranslationPattern();
      expect(pattern.importStatement).toContain("next-intl");
      expect(pattern.hookOrAccessor).toContain("useTranslations");
    });

    it("identifies Next.js components and text props", () => {
      expect(adapter.isKnownTextComponent("Link")).toBe(true);
      expect(adapter.isKnownTextComponent("Image")).toBe(true);
      expect(adapter.isKnownTextProp("alt")).toBe(true);
    });
  });

  describe("Flutter Adapter", () => {
    const adapter = new FlutterAdapter();

    it("identifies Flutter widgets, props, and l10n patterns", () => {
      expect(adapter.isKnownTextComponent("Text")).toBe(true);
      expect(adapter.isKnownTextComponent("TextSpan")).toBe(true);
      expect(adapter.isKnownTextComponent("Container")).toBe(false);

      expect(adapter.isKnownTextProp("labelText")).toBe(true);
      expect(adapter.isKnownTextProp("hintText")).toBe(true);
      expect(adapter.isKnownTextProp("tooltip")).toBe(true);
      expect(adapter.isKnownTextProp("boxFit")).toBe(false);

      expect(adapter.isKnownFeedbackCall("ScaffoldMessenger.showSnackBar")).toBe(true);
      expect(adapter.isKnownFeedbackCall("showDialog")).toBe(true);

      const pattern = adapter.getDefaultTranslationPattern();
      expect(pattern.importStatement).toContain("app_localizations.dart");
      expect(pattern.callSyntax).toBe("l10n");
    });
  });

  describe("Angular Adapter", () => {
    const adapter = new AngularAdapter();

    it("identifies Angular and HTML text components", () => {
      expect(adapter.isKnownTextComponent("h1")).toBe(true);
      expect(adapter.isKnownTextComponent("p")).toBe(true);
      expect(adapter.isKnownTextComponent("button")).toBe(true);
      expect(adapter.isKnownTextComponent("mat-card-title")).toBe(true);
      expect(adapter.isKnownTextComponent("mat-hint")).toBe(true);
      expect(adapter.isKnownTextComponent("div")).toBe(false);
    });

    it("identifies Angular text props and feedback calls", () => {
      expect(adapter.isKnownTextProp("placeholder")).toBe(true);
      expect(adapter.isKnownTextProp("title")).toBe(true);
      expect(adapter.isKnownTextProp("matTooltip")).toBe(true);
      expect(adapter.isKnownTextProp("aria-label")).toBe(true);
      expect(adapter.isKnownTextProp("routerLink")).toBe(false);

      expect(adapter.isKnownFeedbackCall("this.snackBar.open")).toBe(true);
      expect(adapter.isKnownFeedbackCall("alert")).toBe(true);
      expect(adapter.isKnownFeedbackCall("console.log")).toBe(false);
    });

    it("provides Angular translation pattern", () => {
      const pattern = adapter.getDefaultTranslationPattern();
      expect(pattern.importStatement).toContain("@ngx-translate/core");
      expect(pattern.hookOrAccessor).toContain("TranslateService");
      expect(pattern.callSyntax).toBe("this.translate.instant");
    });
  });
});
