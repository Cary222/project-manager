import { describe, expect, it } from "vitest";
import { routeWorkGoal } from "./work-run-ref";

describe("Work durable source convention", () => {
  it("keeps the four Work goals on the documented deterministic routes", () => {
    expect(routeWorkGoal("项目进展汇总")).toBe("project_progress");
    expect(routeWorkGoal("周报")).toBe("weekly_report");
    expect(routeWorkGoal("会议纪要")).toBe("meeting_minutes");
    expect(routeWorkGoal("Coding Task")).toBe("coding");
  });
});
