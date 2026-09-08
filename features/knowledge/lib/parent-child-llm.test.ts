import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  expandToParentSections,
  findEnclosingSection,
  enrichEvidenceWithParentSections,
  type ExpandableEvidence,
} from "./parent-child";
import { buildRagPrompt } from "@/features/ai/search/rag";
import {
  buildSearchablePkmNoteChunks,
  toRankedCandidate,
} from "@/features/knowledge/lib/search";
import type { SearchDocumentPkmNoteRecord } from "@/features/knowledge/lib/search-types";

/**
 * Simulates an LLM answering a targeted question based strictly on provided prompt context.
 * If the context does not contain the required protocol fields, it explicitly returns "未找到详细说明".
 */
function mockLlmAnswer(prompt: string, requiredFields: string[]): string {
  const missingFields = requiredFields.filter(
    (field) => !prompt.includes(field),
  );

  if (missingFields.length > 0) {
    return `根据提供的检索上下文，未找到详细说明，未提及：${missingFields.join("、")}。`;
  }

  return `根据检索到的详细技术说明：
1. 数据包头为 0xAA 0x55
2. 采样率为 1kHz
3. 校验方式采用 CRC16
4. 放大增益支持 1x/8x/64x 可编程切换。`;
}

describe("P7 Parent-Child LLM Response Verification - 杜绝大模型误判「未找到详细说明」", () => {
  const fullDocumentText = `
# 光污染计硬件接口规范

## 1. 系统供电与待机要求
主板供电电压为 3.3V，待机功耗小于 15uA。

## 2. 差分信号与ADC采集协议
光电二极管微弱电流经跨阻放大器输出差分电压信号。
差分输入引脚为 AIN0/AIN1，增益可编程为 1x/8x/64x，采样率为 1kHz。
通信数据帧结构如下：数据包头为 0xAA 0x55，后随 4 字节光照强度浮点数、2 字节温度补偿，以及 CRC16 循环冗余校验码。
采集协议异常时自动重传最多 3 次。

## 3. BLE 无线广播规范
广播名称为 SQM-BLE，广播间隔 500ms。
`;

  const mockNote: SearchDocumentPkmNoteRecord = {
    id: "note_sqm_hw_spec",
    title: "光污染计硬件接口规范",
    content: fullDocumentText,
    userId: "user_engineer_1",
    projectId: "proj_sqm",
    isPublic: true,
    tags: ["硬件", "协议", "光污染"],
    attachments: [],
    user: {
      id: "user_engineer_1",
      name: "研发部张工",
      email: "zhang@example.com",
    },
    project: {
      id: "proj_sqm",
      name: "光污染计",
    },
  };

  const noteUpdatedAt = new Date("2026-08-15T10:00:00Z");

  const question =
    "请详细列出光污染计ADC采集协议中的数据包头、采样率与校验方式。";
  const requiredProtocolFields = ["0xAA 0x55", "1kHz", "CRC16"];

  it("对照组（无层次化切片）：切片截断导致关键协议丢失，大模型误判「未找到详细说明」", () => {
    // Naive sliced fragment cut off halfway through the section
    const truncatedContent =
      "## 2. 差分信号与ADC采集协议\n光电二极管微弱电流经跨阻放大器输出差分电压信号。\n差分输入引脚为 AIN0/AIN1，增益可编程为 1x/8x/64x";

    const candidate = toRankedCandidate({
      document: {
        id: "doc_truncated",
        sourceType: "PKM_NOTE",
        sourceId: mockNote.id,
        title: mockNote.title,
        content: truncatedContent,
        url: `/pkm/notes/${mockNote.id}`,
        metadata: {},
        updatedAt: noteUpdatedAt,
        project: mockNote.project,
      },
      query: question,
      terms: ["ADC", "协议", "光污染计"],
      keywordScore: 1.0,
      semanticScore: 0.9,
    })!;

    const promptTruncated = buildRagPrompt(question, {
      contextText: candidate.snippet,
      results: [candidate],
    });

    const responseTruncated = mockLlmAnswer(
      promptTruncated,
      requiredProtocolFields,
    );

    // Assert: Without parent section context, the LLM is forced to report "未找到详细说明"
    expect(responseTruncated).toContain("未找到详细说明");
    expect(responseTruncated).toContain("0xAA 0x55");
    expect(responseTruncated).toContain("CRC16");
  });

  it("实验组（通过真实 buildSearchablePkmNoteChunks 与 toRankedCandidate 管道）：完整展开父章节，大模型不再误判「未找到详细说明」", async () => {
    // 1. Run real indexing chunking pipeline for PKM notes
    const indexedRecords = await buildSearchablePkmNoteChunks(mockNote);
    expect(indexedRecords.length).toBeGreaterThan(1);

    // Find the child chunk corresponding to Section 2 (ADC Protocol)
    const adcRecord = indexedRecords.find((r) =>
      r.content.includes("差分信号与ADC采集协议"),
    )!;
    expect(adcRecord).toBeDefined();

    // Verify indexing populated hierarchical metadata
    const rawMeta = adcRecord.metadata as Record<string, unknown>;
    expect(rawMeta.isHierarchical).toBe(true);
    expect(rawMeta.parentId).toBeDefined();
    expect(rawMeta.parentContent).toContain("0xAA 0x55");
    expect(rawMeta.sectionTitle).toBe("2. 差分信号与ADC采集协议");

    // 2. Run real toRankedCandidate candidate coercion
    const candidate = toRankedCandidate({
      document: {
        id: "search_doc_adc",
        sourceType: adcRecord.sourceType,
        sourceId: adcRecord.sourceId,
        title: adcRecord.title,
        content: adcRecord.content,
        url: adcRecord.url,
        metadata: (adcRecord.metadata ?? {}) as Prisma.JsonValue,
        updatedAt: noteUpdatedAt,
        project: mockNote.project,
      },
      query: question,
      terms: ["ADC", "协议"],
      keywordScore: 1.0,
      semanticScore: 0.95,
    })!;

    expect(candidate).toBeDefined();
    // Verify coerceMetadata preserved parent-child metadata
    expect(candidate.metadata.isHierarchical).toBe(true);
    expect(candidate.metadata.parentId).toBeDefined();
    expect(candidate.metadata.parentContent).toContain("0xAA 0x55");
    expect(candidate.metadata.sectionTitle).toBe("2. 差分信号与ADC采集协议");

    // 3. Expand candidate through expandToParentSections
    const expandedCandidates = expandToParentSections([
      {
        ...candidate,
        content: candidate.snippet,
      },
    ]);

    expect(expandedCandidates.length).toBe(1);
    const expandedItem = expandedCandidates[0];
    expect(expandedItem.title).toBe(
      "光污染计硬件接口规范 > 2. 差分信号与ADC采集协议",
    );
    expect(expandedItem.content).toContain("0xAA 0x55");
    expect(expandedItem.content).toContain("CRC16 循环冗余校验码");

    // 4. Build prompt and verify LLM answer
    const promptExpanded = buildRagPrompt(question, {
      contextText: expandedItem.content,
      results: [
        {
          ...candidate,
          title: expandedItem.title,
          snippet: expandedItem.content,
        },
      ],
    });

    const responseExpanded = mockLlmAnswer(
      promptExpanded,
      requiredProtocolFields,
    );

    // Assert: With parent-child expansion, the LLM no longer misjudges "未找到详细说明"
    expect(responseExpanded).not.toContain("未找到详细说明");
    expect(responseExpanded).toContain("0xAA 0x55");
    expect(responseExpanded).toContain("1kHz");
    expect(responseExpanded).toContain("CRC16");
    expect(responseExpanded).toContain("可编程切换");
  });

  it("运行时动态父段落提取 (findEnclosingSection) 剥离索引前缀标题并展开遗留文档", async () => {
    // 1. Generate an indexed chunk with real multi-line metadata headers
    const indexedRecords = await buildSearchablePkmNoteChunks(mockNote);
    const adcRecord = indexedRecords.find((r) =>
      r.content.includes("差分信号与ADC采集协议"),
    )!;

    // The content contains multi-line headers: 标题..., 章节..., 作者..., 项目..., 标签..., [chunk X/Y]
    expect(adcRecord.content).toContain("标题");
    expect(adcRecord.content).toContain("作者");

    // 2. findEnclosingSection strips all multi-line headers and accurately matches the section
    const section = findEnclosingSection(fullDocumentText, adcRecord.content);
    expect(section.sectionTitle).toBe("2. 差分信号与ADC采集协议");
    expect(section.sectionContent).toContain("0xAA 0x55");
    expect(section.sectionContent).toContain("CRC16");

    // 3. Legacy evidence without parentContent in metadata
    const legacyEvidence: ExpandableEvidence[] = [
      {
        id: "search_doc_legacy_1",
        title: mockNote.title,
        content: adcRecord.content,
        type: "note",
        metadata: {
          sourceId: mockNote.id,
          sourceType: "PKM_NOTE",
        },
      },
    ];

    const enriched = await enrichEvidenceWithParentSections(legacyEvidence, {
      getNoteContent: vi.fn().mockResolvedValue(fullDocumentText),
      getDocumentText: vi.fn().mockResolvedValue(null),
    });

    expect(enriched[0].title).toBe(
      "光污染计硬件接口规范 > 2. 差分信号与ADC采集协议",
    );
    expect(enriched[0].content).toContain("0xAA 0x55");
    expect(enriched[0].content).toContain("CRC16");

    // 4. Prompt verification
    const prompt = buildRagPrompt(question, {
      contextText: enriched[0].content,
      results: [
        {
          id: enriched[0].id,
          title: enriched[0].title,
          snippet: enriched[0].content,
          url: `/pkm/notes/${mockNote.id}`,
          type: "note",
          score: 0.9,
          keywordScore: 0,
          semanticScore: 0.9,
          metadata: {},
          project: mockNote.project,
        },
      ],
    });

    const response = mockLlmAnswer(prompt, requiredProtocolFields);
    expect(response).not.toContain("未找到详细说明");
    expect(response).toContain("0xAA 0x55");
    expect(response).toContain("1kHz");
    expect(response).toContain("CRC16");
  });
});
