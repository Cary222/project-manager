import { describe, expect, it, vi } from "vitest";
import { ProjectHubPolicyExtension } from "./ProjectHubPolicyExtension";

const context = {
  runId: "run-1",
  tool: "bash",
  args: { command: "rm -rf /tmp/x" },
  workspace: "/tmp",
  userId: "user-1",
};

describe("ProjectHubPolicyExtension", () => {
  it("does not execute an approval-gated tool before approval", async () => {
    const execute = vi.fn(async () => "executed");
    const approval = new Promise<boolean>(() => undefined);
    const extension = new ProjectHubPolicyExtension(
      { check: vi.fn(async () => ({ decision: "approve" as const })) },
      { wait: vi.fn(() => approval) },
    );

    void extension.run(context, execute);
    await Promise.resolve();
    expect(execute).not.toHaveBeenCalled();
  });

  it("never executes denied or rejected tools", async () => {
    const execute = vi.fn(async () => "executed");
    const denied = new ProjectHubPolicyExtension(
      { check: vi.fn(async () => ({ decision: "deny" as const })) },
      { wait: vi.fn(async () => true) },
    );
    await expect(denied.run(context, execute)).rejects.toThrow("denied");
    expect(execute).not.toHaveBeenCalled();

    const rejected = new ProjectHubPolicyExtension(
      { check: vi.fn(async () => ({ decision: "approve" as const })) },
      { wait: vi.fn(async () => false) },
    );
    await expect(rejected.run(context, execute)).rejects.toThrow(
      "not approved",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes only after allow or approval", async () => {
    const execute = vi.fn(async () => "executed");
    const extension = new ProjectHubPolicyExtension(
      { check: vi.fn(async () => ({ decision: "approve" as const })) },
      { wait: vi.fn(async () => true) },
    );
    await expect(extension.run(context, execute)).resolves.toBe("executed");
    expect(execute).toHaveBeenCalledOnce();
  });
});
