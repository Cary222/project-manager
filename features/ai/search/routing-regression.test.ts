import { describe, expect, it } from "vitest";
import {
  detectMode,
  isUserActivityQuery,
} from "../agents/conversation/nodes/detect-intent";

describe("AIChat internal composite query regression", () => {
  it("does not route internal light-pollution design to public weather search", () => {
    expect(detectMode("光污染设计涉及哪些站内信息")).toBe("search");
  });
  it("does not turn a topic's notes/commits/tickets/people into a user-activity query", () => {
    expect(isUserActivityQuery("光污染的笔记提交工单相关人员等")).toBe(false);
  });
});
