import { describe, it, expect } from "vitest";
import {
  normalizeTypos,
  resolveAliases,
  generateSubQueries,
  rewriteQuery,
} from "./query-rewrite";
import { understandQuery } from "./query-understanding";

describe("P4 Query Rewrite - Typo Normalization (normalizeTypos)", () => {
  it("normalizes common device, project and hardware typos", () => {
    expect(normalizeTypos("寻信望远镜有几个版本")).toBe("寻星望远镜有几个版本");
    expect(normalizeTypos("冷东相机的固件")).toBe("冷冻相机的固件");
    expect(normalizeTypos("wifi相加的板端环境")).toBe("wifi相机的板端环境");
    expect(normalizeTypos("无线相加如何配网")).toBe("wifi相机如何配网");
    expect(normalizeTypos("光污染仪的设计规范")).toBe("光污染计的设计规范");
    expect(normalizeTypos("经委仪的说明文档")).toBe("经纬仪的说明文档");
    expect(normalizeTypos("目镜异常的工单")).toBe("目镜切换异常的工单");
    expect(normalizeTypos("修复相机暴光过度")).toBe("修复相机曝光过度");
    expect(normalizeTypos("一键烧录包在那里下载")).toBe(
      "一键tools.zip在那里下载",
    );
  });

  it("leaves clean queries unmodified", () => {
    const clean = "冷冻相机的目镜切换异常工单详情";
    expect(normalizeTypos(clean)).toBe(clean);
  });
});

describe("P4 Query Rewrite - Domain Alias Resolution (resolveAliases)", () => {
  it("resolves domain aliases and technical identifiers", () => {
    const lightPollutionAliases = resolveAliases("光污染");
    expect(lightPollutionAliases).toContain("光污染计");
    expect(lightPollutionAliases).toContain("光污染设计需求文档");

    const coldCameraAliases = resolveAliases("冷冻相机");
    expect(coldCameraAliases).toContain("Cool-Camera");
    expect(coldCameraAliases).toContain("目镜切换");

    const sensorAliases = resolveAliases("sc285sl");
    expect(sensorAliases).toContain("sc285");
    expect(sensorAliases).toContain("曝光控制");

    const toolsAliases = resolveAliases("tools.zip");
    expect(toolsAliases).toContain("update.img");
    expect(toolsAliases).toContain("烧录工具包");
  });

  it("returns empty array for unknown terms", () => {
    expect(resolveAliases("一个未知的生僻词汇12345")).toEqual([]);
  });
});

describe("P4 Query Rewrite - Orthogonal Sub-Query Generation (generateSubQueries)", () => {
  it("generates 3 orthogonal sub-queries for multi-entity relationship questions", () => {
    const plan = understandQuery("光污染设计涉及哪些工单和提交记录");
    const subQueries = generateSubQueries(plan);

    expect(subQueries.length).toBe(3);
    // Distinct orthogonal angles:
    // Angle 1: Documentation / Specs
    expect(
      subQueries.some((q) => q.includes("设计需求") || q.includes("技术文档")),
    ).toBe(true);
    // Angle 2: Work tickets / Defects
    expect(
      subQueries.some((q) => q.includes("关联工单") || q.includes("任务")),
    ).toBe(true);
    // Angle 3: Code commits / VCS
    expect(
      subQueries.some((q) => q.includes("代码提交") || q.includes("commit")),
    ).toBe(true);

    // Each sub-query is unique
    const unique = new Set(subQueries);
    expect(unique.size).toBe(subQueries.length);
  });

  it("generates orthogonal activity sub-queries for person work inquiries", () => {
    const plan = understandQuery("刘工最近在冷冻相机项目里干了什么");
    const subQueries = generateSubQueries(plan);

    expect(subQueries.length).toBe(3);
    expect(
      subQueries.some((q) => q.includes("代码提交") || q.includes("commit")),
    ).toBe(true);
    expect(
      subQueries.some((q) => q.includes("负责工单") || q.includes("任务进展")),
    ).toBe(true);
    expect(
      subQueries.some((q) => q.includes("工作周报") || q.includes("总结")),
    ).toBe(true);
  });

  it("generates milestone and overview sub-queries for project summaries", () => {
    const plan = understandQuery("总结一下寻星望远镜项目的全貌与进展");
    const subQueries = generateSubQueries(plan);

    expect(subQueries.length).toBe(2);
    expect(
      subQueries.some((q) => q.includes("项目总览") || q.includes("架构全貌")),
    ).toBe(true);
    expect(
      subQueries.some((q) => q.includes("核心工单") || q.includes("里程碑")),
    ).toBe(true);
  });
});

describe("P4 Query Rewrite - End-to-End Pipeline (rewriteQuery)", () => {
  it("normalizes typos and expands aliases and sub-queries end-to-end", () => {
    const rawQuery = "请问寻信望远镜的拍摄模式涉及哪些工单和代码提交？";
    const plan = understandQuery(rawQuery);
    const result = rewriteQuery(rawQuery, plan);

    expect(result.originalQuery).toBe(rawQuery);
    expect(result.normalizedQuery).toContain("寻星望远镜");
    expect(result.rewrittenSubject).toContain("寻星望远镜");
    expect(result.subQueries.length).toBeGreaterThanOrEqual(2);
    expect(result.aliases.length).toBeGreaterThan(0);
  });
});
