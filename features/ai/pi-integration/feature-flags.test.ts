import { afterEach, describe, expect, it, vi } from "vitest";

const originalValue = process.env.FEATURE_PI_SESSION_OWNERSHIP;

afterEach(() => {
  if (originalValue === undefined)
    delete process.env.FEATURE_PI_SESSION_OWNERSHIP;
  else process.env.FEATURE_PI_SESSION_OWNERSHIP = originalValue;
  vi.resetModules();
});

describe("isPiOwnershipEnabled", () => {
  it("keeps existing Pi sessions available until ownership is explicitly enabled", async () => {
    delete process.env.FEATURE_PI_SESSION_OWNERSHIP;
    const { isPiOwnershipEnabled } = await import("./feature-flags");
    expect(isPiOwnershipEnabled()).toBe(false);
  });

  it("enables ownership only for an explicit true flag", async () => {
    process.env.FEATURE_PI_SESSION_OWNERSHIP = "true";
    const { isPiOwnershipEnabled } = await import("./feature-flags");
    expect(isPiOwnershipEnabled()).toBe(true);
  });
});
