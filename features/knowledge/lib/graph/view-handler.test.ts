import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import {
  graphQuerySchema,
  readGraphView,
  visibleGraphSql,
} from "./view-service";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  project: vi.fn(),
  execute: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/shared/lib/permissions", () => ({ requireSession: mocks.session }));
vi.mock("@/shared/db/client", () => ({
  prisma: {
    user: { findUnique: mocks.user },
    $transaction: mocks.transaction,
  },
}));
import { handleGraphRequest } from "./view-handler";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "user", role: "ROOT" } });
  // Authoritative DB role deliberately differs from the JWT.
  mocks.user.mockResolvedValue({ id: "user", role: "USER", bannedAt: null });
  mocks.project.mockResolvedValue({ id: "project" });
  mocks.execute.mockResolvedValue(0);
  mocks.query.mockResolvedValue([]);
  mocks.transaction.mockImplementation((callback) =>
    callback({
      $executeRaw: mocks.execute,
      $queryRaw: mocks.query,
      project: { findFirst: mocks.project },
    }),
  );
});
const request = (params = "") =>
  new NextRequest(`http://localhost/api/knowledge/graph/subgraph?${params}`);

describe("graph API authorization and boundaries", () => {
  it("returns 401 without querying the graph when unauthenticated or banned", async () => {
    mocks.session.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await handleGraphRequest(request(), "subgraph")).status).toBe(401);
    mocks.user.mockResolvedValueOnce({
      id: "user",
      role: "ROOT",
      bannedAt: new Date(),
    });
    expect((await handleGraphRequest(request(), "subgraph")).status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([
    "depth=NaN",
    "depth=0",
    "depth=3",
    "limit=-1",
    "limit=201",
    "limit=1.5",
    "nodeId=",
  ])("rejects invalid parameters %s before DB work", async (params) => {
    expect((await handleGraphRequest(request(params), "subgraph")).status).toBe(
      400,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("uses DB membership instead of trusting a stale ROOT session", async () => {
    mocks.project.mockResolvedValueOnce(null);
    expect(
      (await handleGraphRequest(request("projectId=other"), "subgraph")).status,
    ).toBe(404);
    expect(mocks.project.mock.calls[0][0].where.OR).toEqual([
      { ownerId: "user" },
      { members: { some: { userId: "user" } } },
    ]);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns no-store empty global data and a read-only transaction", async () => {
    const response = await handleGraphRequest(request(), "subgraph");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodes: [],
      edges: [],
      truncated: false,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.execute.mock.calls[0][0][0]).toContain("READ ONLY");
  });
  it("returns the same 404 for a missing or inaccessible seed", async () => {
    expect(
      (await handleGraphRequest(request("nodeId=private"), "subgraph")).status,
    ).toBe(404);
    expect(
      (await handleGraphRequest(request("noteId=missing"), "subgraph")).status,
    ).toBe(404);
  });
  it("parameterizes viewer and project and applies ACL to both endpoints before traversal", () => {
    const sql = visibleGraphSql(
      { id: "user' OR true --", role: "USER" },
      "project'",
    );
    expect(sql.text).not.toContain("user' OR true --");
    expect(sql.values).toContain("user' OR true --");
    expect(sql.text).toContain("JOIN visible_nodes s");
    expect(sql.text).toContain("JOIN visible_nodes t");
    expect(sql.text).toContain('n."userId" =');
    expect(sql.text).toContain('OR n."isPublic"');
    expect(sql.text).toContain('r."deletedAt" IS NULL');
  });
  it("deduplicates cycles and performs at most two expansions", async () => {
    const node = (id: string) => ({
      id,
      label: id,
      type: "PROJECT",
      projectId: "p",
      href: null,
    });
    mocks.query
      .mockResolvedValueOnce([node("a")])
      .mockResolvedValueOnce([node("a"), node("b")])
      .mockResolvedValueOnce([node("a"), node("b"), node("c")])
      .mockResolvedValueOnce([]);
    const result = await readGraphView(
      { $queryRaw: mocks.query } as unknown as Prisma.TransactionClient,
      { id: "user" },
      graphQuerySchema.parse({ nodeId: "a", depth: 2 }),
    );
    expect(result.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query.mock.calls[1][0].text).toContain("LIMIT 25");
  });
});
