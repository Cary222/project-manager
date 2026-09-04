import { describe, it, expect } from "vitest";
import { onNodeStart, onNodeEnd } from "../timeline-adapter";
import { buildStepPlan } from "@/features/ai/types/thinking";
import type { TaskRecord } from "@/features/ai/types/timeline";

describe("Timeline step-by-step timing and historical duration calculation", () => {
  it("records accurate node duration between consecutive nodes", () => {
    let createdTask: TaskRecord | null = null;
    let updatedTask: Partial<TaskRecord> | null = null;

    const t0 = 1000;
    const t1 = 2500; // 1.5s execution

    const execId = onNodeStart("detectIntent", t0, (cmd) => {
      if (cmd.op === "create") {
        createdTask = cmd.task;
      }
    });

    expect(createdTask).toBeDefined();
    expect(createdTask!.startTime).toBe(t0);
    expect(createdTask!.nodeName).toBe("detectIntent");
    expect(createdTask!.stepLabel).toBe("理解");
    expect(createdTask!.status).toBe("running");

    onNodeEnd(
      execId,
      { mode: "chat" },
      (cmd) => {
        if (cmd.op === "update") {
          updatedTask = cmd.updates;
        }
      },
      t1,
    );

    expect(updatedTask).toBeDefined();
    expect(updatedTask!.status).toBe("success");
    expect(updatedTask!.endTime).toBe(t1);

    // Duration should be exactly 1500ms
    const duration = updatedTask!.endTime! - createdTask!.startTime;
    expect(duration).toBe(1500);
  });

  it("ensures buildStepPlan matches NODE_STEP_LABELS to prevent duplicate steps", () => {
    const templates = buildStepPlan("auto");
    const labels = templates.map((t) => t.nodeLabel);
    // Should be ["理解", "模型", "检索", "查询", "分析", "生成"]
    expect(labels).toEqual(["理解", "模型", "检索", "查询", "分析", "生成"]);
  });

  it("merges backend tasks cleanly over placeholders without producing duplicate steps", () => {
    const templates = buildStepPlan("auto");
    const now = 10000;

    // 1. Initial placeholders
    const placeholders: TaskRecord[] = templates.map((t, idx) => ({
      id: `placeholder-${t.nodeName}`,
      parentId: null,
      nodeName: t.nodeName,
      stepLabel: t.nodeLabel,
      title: t.nodeLabel,
      category: "reason",
      status: idx === 0 ? "running" : "pending",
      startTime: idx === 0 ? now : 0,
    }));

    // 2. Incoming backend tasks (e.g. chat branch executed detectIntent, modelSelect, generateResponse)
    const incoming: TaskRecord[] = [
      {
        id: "exec-1",
        parentId: null,
        nodeName: "detectIntent",
        stepLabel: "理解",
        title: "正在理解你的问题",
        status: "success",
        category: "reason",
        startTime: now,
        endTime: now + 50,
      },
      {
        id: "exec-2",
        parentId: null,
        nodeName: "modelSelect",
        stepLabel: "模型",
        title: "正在选择合适的模型",
        status: "success",
        category: "system",
        startTime: now + 50,
        endTime: now + 60,
      },
      {
        id: "exec-3",
        parentId: null,
        nodeName: "generateResponse",
        stepLabel: "生成",
        title: "正在整理答案",
        status: "success",
        category: "reason",
        startTime: now + 60,
        endTime: now + 13000,
      },
    ];

    // 3. Merge algorithm from AiChatPanel
    const incomingByNodeOrLabel = new Map<string, TaskRecord>();
    for (const t of incoming) {
      if (t.nodeName) incomingByNodeOrLabel.set(t.nodeName, t);
      if (t.stepLabel) incomingByNodeOrLabel.set(t.stepLabel, t);
    }

    const merged: TaskRecord[] = [];
    const matchedTaskIds = new Set<string>();

    for (const ph of placeholders) {
      const nodeName =
        ph.nodeName ??
        (ph.id.startsWith("placeholder-")
          ? ph.id.replace("placeholder-", "")
          : undefined);
      const real =
        (nodeName && incomingByNodeOrLabel.get(nodeName)) ||
        incomingByNodeOrLabel.get(ph.stepLabel);
      if (real) {
        merged.push(real);
        matchedTaskIds.add(real.id);
      } else {
        merged.push(ph);
      }
    }

    for (const t of incoming) {
      if (!matchedTaskIds.has(t.id)) {
        merged.push(t);
      }
    }

    // Filter out un-executed pending placeholders on done
    const hasRealTasks = merged.some((t) => !t.id.startsWith("placeholder-"));
    const finalTasks = merged.filter((t) => {
      if (
        hasRealTasks &&
        t.id.startsWith("placeholder-") &&
        t.status === "pending"
      ) {
        return false;
      }
      return true;
    });

    // Should contain exactly the 3 executed steps, NOT 11 or 6
    expect(finalTasks.length).toBe(3);
    expect(finalTasks.map((t) => t.stepLabel)).toEqual([
      "理解",
      "模型",
      "生成",
    ]);
    expect(finalTasks.map((t) => t.endTime! - t.startTime)).toEqual([
      50, 10, 12940,
    ]);
  });

  it("calculates historical task durations correctly without drifting to now (prevents 78848s bug)", () => {
    const historicalTime = Date.now() - 78848 * 1000; // 21.9 hours ago

    const tasks: TaskRecord[] = [
      {
        id: "step-1",
        parentId: null,
        nodeName: "detectIntent",
        stepLabel: "理解",
        title: "理解意图",
        status: "success",
        category: "reason",
        startTime: historicalTime,
        endTime: historicalTime + 1200, // 1.2s
      },
      {
        id: "step-2",
        parentId: null,
        nodeName: "modelSelect",
        stepLabel: "模型",
        title: "模型选择",
        status: "success",
        category: "system",
        startTime: historicalTime + 1200,
        endTime: historicalTime + 1500, // 0.3s
      },
      {
        id: "step-3",
        parentId: null,
        nodeName: "searchKnowledge",
        stepLabel: "检索",
        title: "知识检索",
        status: "success",
        category: "tool",
        startTime: historicalTime + 1500,
        endTime: historicalTime + 2600, // 1.1s
      },
      {
        id: "step-4",
        parentId: null,
        nodeName: "searchStructured",
        stepLabel: "查询",
        title: "数据库查询",
        status: "success",
        category: "tool",
        startTime: historicalTime + 2600,
        endTime: historicalTime + 4100, // 1.5s
      },
      {
        id: "step-5",
        parentId: null,
        nodeName: "generateResponse",
        stepLabel: "生成",
        title: "生成回答",
        status: "success",
        category: "reason",
        startTime: historicalTime + 4100,
        endTime: historicalTime + 12000, // 7.9s
      },
    ];

    function computeStepDuration(
      task: TaskRecord,
      now: number,
    ): number | undefined {
      if (task.status === "pending") return undefined;
      if (task.status === "running") {
        return typeof task.startTime === "number" && task.startTime > 0
          ? Math.max(0, now - task.startTime)
          : undefined;
      }
      if (
        typeof task.endTime === "number" &&
        typeof task.startTime === "number" &&
        task.endTime >= task.startTime
      ) {
        return task.endTime - task.startTime;
      }
      return undefined;
    }

    const currentNow = Date.now();
    const durations = tasks.map((t) => computeStepDuration(t, currentNow));

    expect(durations).toEqual([1200, 300, 1100, 1500, 7900]);

    const starts = tasks.map((t) => t.startTime);
    const ends = tasks.map((t) => t.endTime!);
    const totalMs = Math.max(...ends) - Math.min(...starts);
    expect(totalMs).toBe(12000); // 12s total
  });
});
