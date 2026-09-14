import { describe, expect, it } from "vitest";
import {
  CAPABILITY_CATALOG,
  getCapability,
  getCapabilitiesForAgent,
  getSideEffectToolNames,
  capabilityCatalogPrompt,
} from "./capability-registry";

describe("Shared Capability Registry", () => {
  it("导出非空目录", () => {
    expect(CAPABILITY_CATALOG.length).toBeGreaterThanOrEqual(7);
  });

  it("每个工具都有名、描述、kind、args", () => {
    for (const spec of CAPABILITY_CATALOG) {
      expect(spec.name).toBeTruthy();
      expect(spec.description).toBeTruthy();
      expect(["read", "write", "execute", "report"]).toContain(spec.kind);
      expect(spec.args).toBeDefined();
      expect(spec.availableIn.length).toBeGreaterThan(0);
    }
  });

  it("getCapability 按名查到正确 spec", () => {
    const bq = getCapability("business_query");
    expect(bq).toBeDefined();
    expect(bq!.kind).toBe("read");
    expect(bq!.sideEffect).toBe(false);
  });

  it("getCapability 未知名返回 undefined", () => {
    expect(getCapability("hallucinated_tool")).toBeUndefined();
  });

  it("getCapabilitiesForAgent 过滤 WORK", () => {
    const workTools = getCapabilitiesForAgent("WORK");
    expect(workTools.length).toBeGreaterThanOrEqual(8);
  });

  it("getCapabilitiesForAgent CONVERSATION 包含检索与外部能力", () => {
    const chatTools = getCapabilitiesForAgent("CONVERSATION");
    expect(chatTools.length).toBeGreaterThanOrEqual(2);
    const names = chatTools.map((t) => t.name);
    expect(names).toContain("search_knowledge");
    expect(names).toContain("web_search");
  });

  it("getSideEffectToolNames 返回有副作用的工具", () => {
    const names = getSideEffectToolNames();
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("execute_command");
    expect(names).not.toContain("business_query");
  });

  it("capabilityCatalogPrompt 生成非空 prompt", () => {
    const prompt = capabilityCatalogPrompt("WORK");
    expect(prompt).toContain("business_query");
    expect(prompt).toContain("execute_command");
    expect(prompt).toContain("副作用");
  });

  it("工具名全局唯一", () => {
    const names = CAPABILITY_CATALOG.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
