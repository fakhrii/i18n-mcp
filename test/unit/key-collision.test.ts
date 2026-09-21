import { describe, it, expect } from "vitest";
import { resolveKeyCollision } from "../../src/core/planning/key-collision-resolver.js";

describe("Key Collision Resolver", () => {
  it("accepts candidate key when no collision exists in namespace", () => {
    const existingKeys = new Set(["CANCEL", "SAVE"]);
    const res = resolveKeyCollision("SUBMIT", "Submit", "common", existingKeys);
    expect(res.key).toBe("SUBMIT");
    expect(res.action).toBe("CREATE");
  });

  it("reuses existing key when colliding key has the exact or normalized meaning", () => {
    const existingKeys = new Set(["CANCEL", "SAVE"]);
    const existingValues = new Map([
      ["CANCEL", "Cancel"],
      ["SAVE", "Save"],
    ]);

    const res = resolveKeyCollision(
      "CANCEL",
      "cancel...",
      "common",
      existingKeys,
      existingValues
    );
    expect(res.key).toBe("CANCEL");
    expect(res.action).toBe("REUSE");
    expect(res.reusedExisting).toBe(true);
  });

  it("differentiates key when candidate key has a conflicting semantic meaning", () => {
    const existingKeys = new Set(["OPEN"]);
    const existingValues = new Map([["OPEN", "Open"]]);

    const res = resolveKeyCollision(
      "OPEN",
      "Open account",
      "common",
      existingKeys,
      existingValues
    );
    expect(res.key).toBe("OPEN_ACCOUNT");
    expect(res.action).toBe("CREATE");
  });

  it("generates suffixed key when words cannot further differentiate", () => {
    const existingKeys = new Set(["SAVE", "SAVE_CHANGES"]);
    const existingValues = new Map([
      ["SAVE", "Save record"],
      ["SAVE_CHANGES", "Save all changes"],
    ]);

    const res = resolveKeyCollision(
      "SAVE",
      "Save bookmark",
      "common",
      existingKeys,
      existingValues
    );
    // Should produce SAVE_BOOKMARK
    expect(res.key).toBe("SAVE_BOOKMARK");
    expect(res.action).toBe("CREATE");
  });

  it("falls back to numbered suffix if name cannot be differentiated", () => {
    const existingKeys = new Set(["CONFIRM", "CONFIRM_2"]);
    const existingValues = new Map([
      ["CONFIRM", "Confirm deletion"],
      ["CONFIRM_2", "Confirm order"],
    ]);

    const res = resolveKeyCollision(
      "CONFIRM",
      "Confirm",
      "common",
      existingKeys,
      existingValues
    );
    expect(res.key).toBe("CONFIRM_3");
    expect(res.action).toBe("CREATE");
  });
});
