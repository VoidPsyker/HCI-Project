import { describe, expect, it } from "vitest";

describe("browser storage environment", () => {
  it.each(["localStorage", "sessionStorage"] as const)("provides jsdom %s to browser code", (name) => {
    const storage = globalThis[name];
    expect(storage).toBeInstanceOf(Storage);
    storage.setItem("environment-check", "saved");
    expect(window[name].getItem("environment-check")).toBe("saved");
    storage.removeItem("environment-check");
  });
});
