import { describe, it, expect } from "vitest";
import {
  splitMarkdownIntoSections,
  createHierarchicalChunks,
  expandToParentSections,
  findEnclosingSection,
} from "./parent-child";

describe("P7 Parent-Child Retrieval - Section Splitting (splitMarkdownIntoSections)", () => {
  it("splits Markdown documents by heading boundaries and preserves titles", () => {
    const md = `
# 光污染计系统设计说明

## 1. 硬件架构设计
光污染计硬件主要由核心控制器、光电二极管放大链路及低功耗电源管理组成。
光敏元件采集环境光强度，通过跨阻放大器转换为差分电压信号送入ADC。

## 2. 通信协议与数据格式
设备支持 BLE 5.0 与串口协议通讯。
数据帧格式：包头 0xAA 0x55，后跟 4 字节光照强度浮点数、2 字节温度补偿，以及 CRC16 校验码。

## 3. 固件升级机制
支持 OTA 在线双备份升级，升级包命名规范为 update.bin。
`;

    const sections = splitMarkdownIntoSections(md);

    expect(sections.length).toBe(4);
    expect(sections[0].title).toBe("光污染计系统设计说明");
    expect(sections[1].title).toBe("1. 硬件架构设计");
    expect(sections[1].content).toContain("跨阻放大器");
    expect(sections[2].title).toBe("2. 通信协议与数据格式");
    expect(sections[2].content).toContain("CRC16");
    expect(sections[3].title).toBe("3. 固件升级机制");
  });

  it("falls back to natural paragraph blocks when no markdown headings exist", () => {
    const text = `
第一段内容：这里记录了相关的技术讨论和架构方案说明。

第二段内容：讨论了具体的实现细节和接口约定，确认采用标准 JSON 通讯。

第三段内容：测试与验证结果表明系统稳定性良好，延时控制在 50ms 以内。
`;
    const sections = splitMarkdownIntoSections(text, 100);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections[0].content).toContain("第一段内容");
  });

  it("strips multi-line indexed headers (标题, 章节, 作者, 项目, [chunk]) and finds enclosing section", () => {
    const md = `
# 光污染计系统设计说明

## 1. 硬件架构设计
光敏元件采集环境光强度，通过跨阻放大器转换为差分电压信号送入ADC。

## 2. 通信协议与数据格式
设备支持 BLE 5.0 与串口协议通讯。
数据帧格式：包头 0xAA 0x55，后跟 4 字节光照强度浮点数、2 字节温度补偿，以及 CRC16 校验码。
`;
    const rawSnippet = [
      "标题 光污染计系统设计说明",
      "章节 2. 通信协议与数据格式",
      "作者 研发部张工",
      "项目 光污染计",
      "[chunk 2/5]",
      "数据帧格式：包头 0xAA 0x55，后跟 4 字节光照强度浮点数",
    ].join("\n");

    const result = findEnclosingSection(md, rawSnippet);
    expect(result.sectionTitle).toBe("2. 通信协议与数据格式");
    expect(result.sectionContent).toContain("CRC16 校验码");
  });
});

describe("P7 Parent-Child Retrieval - Hierarchical Chunk Generation (createHierarchicalChunks)", () => {
  it("creates two-tier parent-child chunks with bi-directional references", () => {
    const doc = `
# 冷冻相机硬件与制冷控制指南

## 制冷控制与TEC驱动
TEC 控制器通过 PWM 调节半导体制冷片电流。
板载 NTC 实时采样传感器温度，经由 EMA 滤波后作为 PID 闭环输入。
目标温度范围为 -20℃ 至 10℃，控温精度 ±0.5℃。
当检测到散热端过热时，硬件保护中断将强制关断 TEC 供电。
`;

    const hierarchy = createHierarchicalChunks(doc, "freeze_cam_doc", {
      parentMaxChars: 2000,
      childMaxChars: 120, // small child chunk for high-precision vector search
      childOverlap: 20,
    });

    // Parents
    expect(hierarchy.parents.length).toBe(2);
    const tecParent = hierarchy.parents[1];
    expect(tecParent.sectionTitle).toBe("制冷控制与TEC驱动");
    expect(tecParent.childIds.length).toBeGreaterThan(1);

    // Children
    expect(hierarchy.children.length).toBeGreaterThan(1);
    const firstChild = hierarchy.children[0];
    expect(firstChild.parentId).toBe(hierarchy.parents[0].id);

    // All children link to valid parents
    for (const child of hierarchy.children) {
      expect(hierarchy.parents.some((p) => p.id === child.parentId)).toBe(true);
      expect(child.content.length).toBeGreaterThan(0);
    }
  });
});

describe("P7 Parent-Child Retrieval - Context Expansion & Deduplication (expandToParentSections)", () => {
  it("expands child chunks to full parent section context and deduplicates sibling matches", () => {
    const parentSectionContent = `
## 2. 通信协议与数据格式
设备支持 BLE 5.0 与串口协议通讯。
数据帧格式：包头 0xAA 0x55，后跟 4 字节光照强度浮点数、2 字节温度补偿，以及 CRC16 校验码。
采集周期可配置为 100ms 至 10s。
`;

    // 2 child chunks from the SAME parent section matched
    const retrievedMatches = [
      {
        id: "chunk_child_1",
        title: "光污染计设计需求文档",
        content: "数据帧格式：包头 0xAA 0x55",
        metadata: {
          parentId: "parent_sec_2",
          parentContent: parentSectionContent,
          sectionTitle: "2. 通信协议与数据格式",
        },
      },
      {
        id: "chunk_child_2",
        title: "光污染计设计需求文档",
        content: "采集周期可配置为 100ms 至 10s",
        metadata: {
          parentId: "parent_sec_2",
          parentContent: parentSectionContent,
          sectionTitle: "2. 通信协议与数据格式",
        },
      },
      // Distinct chunk from another section
      {
        id: "chunk_child_3",
        title: "光污染计设计需求文档",
        content: "外壳防护等级为 IP65",
        metadata: {
          parentId: "parent_sec_3",
          parentContent:
            "## 3. 结构防护\n外壳防护等级为 IP65，密封圈采用硅胶材质。",
          sectionTitle: "3. 结构防护",
        },
      },
    ];

    const expanded = expandToParentSections(retrievedMatches);

    // Sibling chunks 1 and 2 should be merged into 1 parent section!
    expect(expanded.length).toBe(2);

    // Check first expanded item
    expect(expanded[0].title).toBe(
      "光污染计设计需求文档 > 2. 通信协议与数据格式",
    );
    // Contains complete section text, not just isolated fragment
    expect(expanded[0].content).toContain("CRC16 校验码");
    expect(expanded[0].content).toContain("设备支持 BLE 5.0");

    // Check second expanded item
    expect(expanded[1].title).toBe("光污染计设计需求文档 > 3. 结构防护");
    expect(expanded[1].content).toContain("密封圈采用硅胶材质");
  });

  it("preserves standalone documents without parent metadata intact", () => {
    const standalone = [
      {
        id: "doc_1",
        title: "工单说明",
        content: "独立的工单内容",
        metadata: null,
      },
    ];
    const result = expandToParentSections(standalone);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("独立的工单内容");
  });
});
