import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { KnowledgeGraphSection } from "./KnowledgeGraphSection";
import type { GraphViewData } from "../../lib/graph/view-types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), session: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Canvas() {
      return <div data-testid="canvas" />;
    },
}));
const node = (id: string) => ({
  id,
  label: id,
  type: "PROJECT",
  projectId: "p",
  href: `/projects/${id}`,
});
const initial: GraphViewData = {
  nodes: [node("Alpha")],
  edges: [],
  truncated: false,
};
beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.session.mockReturnValue({
    status: "authenticated",
    data: { user: { id: "viewer" } },
  });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => initial });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("reusable graph view", () => {
  it("loads on demand in PKM and forwards note scope", async () => {
    render(<KnowledgeGraphSection noteId="note1" />);
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看关联知识图谱" }));
    await screen.findByRole("button", { name: "项目Alpha" });
    expect(String(mocks.fetch.mock.calls[0][0])).toContain("noteId=note1");
  });
  it("expands without losing the existing nodes or project restriction", async () => {
    render(<KnowledgeGraphView projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: "项目Alpha" }));
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nodes: [node("Beta")],
        edges: [],
        truncated: false,
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "展开相连节点" }));
    await screen.findByRole("button", { name: "项目Beta" });
    expect(screen.getByRole("button", { name: "项目Alpha" })).toBeTruthy();
    expect(String(mocks.fetch.mock.calls.at(-1)?.[0])).toContain("projectId=p");
    expect(String(mocks.fetch.mock.calls.at(-1)?.[0])).toContain(
      "nodeId=Alpha",
    );
  });
  it("resets the data when the host switches note scope", async () => {
    const view = render(<KnowledgeGraphView noteId="note1" />);
    await screen.findByRole("button", { name: "项目Alpha" });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ nodes: [], edges: [], truncated: false }),
    });
    view.rerender(<KnowledgeGraphView noteId="note2" />);
    await waitFor(() =>
      expect(String(mocks.fetch.mock.calls.at(-1)?.[0])).toContain(
        "noteId=note2",
      ),
    );
    expect(screen.queryByRole("button", { name: "项目Alpha" })).toBeNull();
  });
  it("shows a retryable error instead of exposing old data", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 });
    render(<KnowledgeGraphView />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.queryByTestId("canvas")).toBeNull();
  });
  it("does not load graph data when logged out", () => {
    mocks.session.mockReturnValue({ status: "unauthenticated", data: null });
    render(<KnowledgeGraphView />);
    expect(screen.getByText("请先登录后查看知识图谱。")).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
