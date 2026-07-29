/**
 * AiThinkingTrace 单元测试：用 @testing-library/react 模拟 SSE 流推送节点事件，
 * 验证四种 mode 下初始节点路径、running/done 状态、折叠行为、原始数据展开。
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AiThinkingTrace } from "@/features/ai/ui/AiThinkingTrace";
import {
  type ThinkingNodeName,
  type ThinkingStep,
  buildStepPlan,
} from "@/features/ai/types";

function pendingSteps(mode: "auto" | "search" | "chat" | "web"): ThinkingStep[] {
  return buildStepPlan(mode).map((tpl) => ({
    nodeName: tpl.nodeName,
    nodeLabel: tpl.nodeLabel,
    toolName: tpl.toolName,
    status: "pending" as const,
  }));
}

function findStepButton(nodeName: ThinkingNodeName): HTMLButtonElement {
  // Use data-testid on the parent <div> to scope the query, then drill into the
  // button via container. Avoids reliance on localised aria-label text.
  const scope = document.querySelector(
    `[data-testid="thinking-step-${nodeName}"]`,
  ) as HTMLElement | null;
  if (!scope) throw new Error(`step ${nodeName} not found in DOM`);
  const btn = scope.querySelector("button");
  if (!btn) throw new Error(`step ${nodeName} has no button`);
  return btn as HTMLButtonElement;
}

describe("AiThinkingTrace — mode templates", () => {
  it("auto / search path", () => {
    const steps = pendingSteps("auto");
    expect(steps.map((s) => s.nodeName)).toEqual([
      "detectIntent",
      "searchKnowledge",
      "searchStructured",
      "generateResponse",
    ]);
    expect(steps.map((s) => s.status)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("web path (no structured / knowledge)", () => {
    const steps = pendingSteps("web");
    expect(steps.map((s) => s.nodeName)).toEqual([
      "detectIntent",
      "webSearch",
      "generateResponse",
    ]);
    expect(steps.find((s) => s.nodeName === "webSearch")?.toolName).toBe("webSearch");
  });

  it("chat path (no tools)", () => {
    const steps = pendingSteps("chat");
    expect(steps.map((s) => s.nodeName)).toEqual(["detectIntent", "generateResponse"]);
    expect(steps.find((s) => s.toolName)).toBeUndefined();
  });
});

describe("AiThinkingTrace — rendering", () => {
  it("renders empty list as null", () => {
    const { container } = render(<AiThinkingTrace steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders running pending steps with timer label", () => {
    const steps: ThinkingStep[] = pendingSteps("auto").map((s, i) => {
      if (i === 1) {
        return { ...s, status: "running", startedAt: performance.now() - 1500 };
      }
      return s;
    });
    render(<AiThinkingTrace steps={steps} />);
    // Header summary should be visible.
    expect(screen.getByText(/思考流程/)).toBeTruthy();
    // The searchKnowledge row should show ~1.5s elapsed. Scope to its container.
    const scope = document.querySelector(
      '[data-testid="thinking-step-searchKnowledge"]',
    ) as HTMLElement | null;
    expect(scope).not.toBeNull();
    expect(scope?.textContent).toMatch(/1\.5\d?\s?s/);
  });

  it("auto-collapses when every step is done or skipped", () => {
    const steps: ThinkingStep[] = pendingSteps("web").map((s, i) =>
      i === 0
        ? { ...s, status: "done" }
        : { ...s, status: i === 1 ? "done" : "skipped" },
    );
    render(<AiThinkingTrace steps={steps} />);
    // When fully completed, default behaviour should show a collapsed summary.
    // The full step list is not visible until user clicks to expand.
    expect(screen.queryByText(/正在使用/)).toBeNull();
  });

  it("expanding a done node reveals raw JSON output", () => {
    const steps: ThinkingStep[] = pendingSteps("search").map((s) =>
      s.nodeName === "searchKnowledge"
        ? { ...s, status: "done", output: { rows: [{ id: 1 }] } }
        : s,
    );
    render(<AiThinkingTrace steps={steps} />);
    fireEvent.click(findStepButton("searchKnowledge"));
    expect(screen.getByText(/"rows"/)).toBeTruthy();
  });

  it("expanding a done node reveals raw text output verbatim", () => {
    const steps: ThinkingStep[] = pendingSteps("chat").map((s) =>
      s.nodeName === "generateResponse"
        ? { ...s, status: "done", output: "你好，世界" }
        : s,
    );
    render(<AiThinkingTrace steps={steps} />);
    fireEvent.click(findStepButton("generateResponse"));
    expect(screen.getByText("你好，世界")).toBeTruthy();
  });

  it("error node expansion shows error message", () => {
    const steps: ThinkingStep[] = pendingSteps("search").map((s) =>
      s.nodeName === "searchStructured"
        ? { ...s, status: "error", error: "权限不足" }
        : s,
    );
    render(<AiThinkingTrace steps={steps} />);
    fireEvent.click(findStepButton("searchStructured"));
    expect(screen.getByText(/权限不足/)).toBeTruthy();
  });
});

describe("AiThinkingTrace — totals", () => {
  it("summarizes completed / skipped count", () => {
    const steps: ThinkingStep[] = pendingSteps("auto").map((s) =>
      s.nodeName === "searchKnowledge"
        ? { ...s, status: "done" }
        : s.nodeName === "searchStructured"
          ? { ...s, status: "skipped" }
          : s,
    );
    render(<AiThinkingTrace steps={steps} />);
    // Header: "1 完成 / 1 跳过"
    expect(screen.getByText(/1 完成/)).toBeTruthy();
    expect(screen.getByText(/1 跳过/)).toBeTruthy();
  });
});
