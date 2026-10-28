import { describe, it, expect } from "vitest";
import { VueAdapter } from "../../src/integrations/adapters/vue.adapter.js";
import { scanVueSourceFile } from "../../src/core/scanner/vue-scanner.js";

describe("Vue 3 & Nuxt Framework Adapter Unit Tests", () => {
  const adapter = new VueAdapter();

  it("identifies Vue / Nuxt text components and sinks", () => {
    expect(adapter.isKnownTextComponent("router-link")).toBe(true);
    expect(adapter.isKnownTextComponent("nuxt-link")).toBe(true);
    expect(adapter.isKnownTextComponent("el-button")).toBe(true);
    expect(adapter.isKnownTextComponent("v-btn")).toBe(true);
    expect(adapter.isKnownTextComponent("v-card-title")).toBe(true);
    expect(adapter.isKnownTextComponent("button")).toBe(true);
    expect(adapter.isKnownTextComponent("p")).toBe(true);
    expect(adapter.isKnownTextComponent("div")).toBe(false);
  });

  it("identifies text attributes and props", () => {
    expect(adapter.isKnownTextProp("placeholder")).toBe(true);
    expect(adapter.isKnownTextProp("title")).toBe(true);
    expect(adapter.isKnownTextProp("aria-label")).toBe(true);
    expect(adapter.isKnownTextProp("hint")).toBe(true);
    expect(adapter.isKnownTextProp("tooltip")).toBe(true);
    expect(adapter.isKnownTextProp("key")).toBe(false);
  });

  it("returns default translation pattern with useI18n", () => {
    const pattern = adapter.getDefaultTranslationPattern();
    expect(pattern.importStatement).toContain("useI18n");
    expect(pattern.hookOrAccessor).toContain("useI18n()");
    expect(pattern.callSyntax).toBe("t");
  });

  it("scans Vue SFC (.vue) extracting strings from template and script sections", () => {
    const vueSfc = `
<template>
  <div class="login-container">
    <h1>Welcome to Dashboard</h1>
    <input type="text" placeholder="Enter your username" />
    <button>Sign In</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const errorMsg = "Invalid email or password";
</script>
`;

    const detections = scanVueSourceFile({
      filePath: "src/views/Login.vue",
      sourceCode: vueSfc,
      onlyUserFacing: true,
      minConfidence: 0.5,
    });

    const texts = detections.map((d) => d.text);
    expect(texts).toContain("Welcome to Dashboard");
    expect(texts).toContain("Enter your username");
    expect(texts).toContain("Sign In");
    expect(texts).toContain("Invalid email or password");
  });
});
