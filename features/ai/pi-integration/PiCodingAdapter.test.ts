import { describe, expect, it, vi } from "vitest";
import { PiCodingAdapter, type PiRuntimePort } from "./PiCodingAdapter";
import * as ownershipModule from "./pi-session-ownership";

describe("PiCodingAdapter", () => {
  it("starts runtime and records piSessionOwnership for work_coding", async () => {
    const shutdown = vi.fn(async () => undefined);
    const mockRuntime: PiRuntimePort = {
      start: vi.fn(async () => ({
        sessionId: "pi-sess-123",
        shutdown,
      })),
    };

    const createOwnershipSpy = vi
      .spyOn(ownershipModule, "createPiSessionOwnership")
      .mockResolvedValueOnce({
        id: "own-1",
        piSessionId: "pi-sess-123",
        userId: "user-1",
        source: "work_coding",
        projectId: "proj-1",
        ticketId: "ticket-100",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

    const adapter = new PiCodingAdapter(mockRuntime);
    const result = await adapter.start({
      userId: "user-1",
      cwd: "/repo",
      prompt: "Fix bug in ticket",
      projectId: "proj-1",
      ticketId: "ticket-100",
    });

    expect(mockRuntime.start).toHaveBeenCalledWith({
      cwd: "/repo",
      prompt: "Fix bug in ticket",
    });
    expect(createOwnershipSpy).toHaveBeenCalledWith({
      piSessionId: "pi-sess-123",
      userId: "user-1",
      source: "work_coding",
      projectId: "proj-1",
      ticketId: "ticket-100",
    });
    expect(result.sessionId).toBe("pi-sess-123");
    expect(result.runId).toMatch(/^work-pi-/);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("shuts down runtime if ownership creation fails (Saga rollback)", async () => {
    const shutdown = vi.fn(async () => undefined);
    const mockRuntime: PiRuntimePort = {
      start: vi.fn(async () => ({
        sessionId: "pi-sess-456",
        shutdown,
      })),
    };

    vi.spyOn(ownershipModule, "createPiSessionOwnership").mockRejectedValueOnce(
      new Error("DB connection lost"),
    );

    const adapter = new PiCodingAdapter(mockRuntime);
    await expect(
      adapter.start({
        userId: "user-1",
        cwd: "/repo",
        prompt: "Refactor ticket module",
      }),
    ).rejects.toThrow("DB connection lost");

    expect(shutdown).toHaveBeenCalledOnce();
  });
});
