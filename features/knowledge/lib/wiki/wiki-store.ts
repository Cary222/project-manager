import type { WikiPage } from "./types";

/**
 * In-memory synthesized wiki knowledge layer.
 * Pre-seeded with comprehensive system overviews that map to raw evidence in DB.
 */
const WIKI_PAGES: WikiPage[] = [
  {
    id: "wiki_wifi_cam",
    slug: "project-wifi-camera",
    title: "《wifi相机 项目研发全貌与技术架构总览》",
    category: "project_overview",
    projectId: "cmpnf6jrg0000jl1y07dg6yqw",
    projectName: "wifi相机",
    summary:
      "wifi相机（内部代号 Skynex）是面向天文与监控场景的高清无线图传相机，集成了 720p/1080p WebRTC 低延迟开流、A/B 分区 OTA 固件升级与板端内置 AP 服务。",
    content: `# 《wifi相机 项目研发全貌与技术架构总览》

## 1. 项目定位与核心能力
wifi相机（Skynex）是专为户外天文拍摄与实时预览设计的无线相机设备。主板采用嵌入式 Linux 平台，内置 Wi-Fi AP 与客户端双模式，支持手机 APP 极速连接并进行曝光、增益与图传设置。

## 2. 核心技术模块
- **板端系统与网络 (Skynex)**：支持板端内置 HTTP 文件服务器（可访问 http://192.168.1.1:8999/sd/ 预览并下载 FITS/PNG/MP4 拍摄文件），配有一键烧录工具包 tools.zip (#10010)。
- **WebRTC 视频流与曝光控制**：放开 720p ROI 的 90fps 高帧率模式 (#10168)，APP 端实现曝光参数平滑滚轮调节 (#10174)。
- **固件与电源管理**：支持 A/B 分区双备份 OTA 升级；排查并修复了电池漏电放空后无法充电的电源硬件缺陷 (#10011)。

## 3. 关联工单与里程碑
- **#10010**：整理wifi相机云端环境与板端 A/B OTA
- **#10011**：wifi相机的漏电漏完后充不进去排查
- **#10168**：放开 720 ROI 的 90fps 标签并支持 WebRTC 相机参数
- **#10174**：WIFI相机APP曝光滚轮设置
- **#10191**：wifi相机mcu重构
`,
    keyModules: [
      {
        name: "板端系统与固件 (Skynex)",
        description: "嵌入式 HTTP 预览服务与 A/B OTA 升级机制",
      },
      {
        name: "WebRTC 低延迟图传",
        description: "支持 720p 90fps ROI 与手机滚轮曝光控制",
      },
      { name: "电源与充电管理", description: "低功耗休眠与电池过放充电保护" },
    ],
    relatedTickets: [
      { ticketNo: 10010, title: "整理wifi相机云端环境" },
      { ticketNo: 10011, title: "wifi相机的漏电漏完后充不进去的，需要排查" },
      {
        ticketNo: 10168,
        title: "放开 720 ROI 的 90fps 标签，并支持 WebRTC 相机 ROI 参数",
      },
      { ticketNo: 10174, title: "WIFI相机APP曝光滚轮设置" },
      { ticketNo: 10191, title: "wifi相机mcu重构" },
    ],
    sourceEvidence: [
      {
        id: "cmpngf1r6000cjl1ymwx19gvq",
        type: "ticket",
        title: "#10010 整理wifi相机云端环境",
        url: "/tickets/cmpngf1r6000cjl1ymwx19gvq",
      },
      {
        id: "cmpov1btx0005jlbe1xe0ldlt",
        type: "ticket",
        title: "#10011 wifi相机的漏电排查",
        url: "/tickets/cmpov1btx0005jlbe1xe0ldlt",
      },
      {
        id: "doc_wifi_excel",
        type: "document",
        title: "WiFi相机第一批次量产问题反馈表.xlsx",
        url: "/projects/cmpnf6jrg0000jl1y07dg6yqw",
      },
    ],
    version: 1,
    generatedAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  },
  {
    id: "wiki_cold_cam",
    slug: "project-cold-camera",
    title: "《冷冻相机 项目研发全貌与技术架构总览》",
    category: "project_overview",
    projectId: "cmpm67cb20000jleuf7z8f9f6",
    projectName: "冷冻相机",
    summary:
      "冷冻相机是面向深空天文摄影的高灵敏度制冷相机，搭载半导体制冷片（TEC）恒温控制、RV1103b MCU 固件与多态电动滤镜切换轮。",
    content: `# 《冷冻相机 项目研发全貌与技术架构总览》

## 1. 项目定位与核心能力
冷冻相机专为长时间曝光降噪设计，通过将图像传感器制冷至环境温度以下 30℃，大幅降低暗电流热噪声，呈现清晰的天体细节。

## 2. 核心技术模块
- **TEC 半导体制冷控制**：板载 NTC 实时采样温度，采用 16 点 DMA 平均与 EMA 滤波算法，通过 PWM 精准闭环控制 TEC 电流。
- **光学滤镜轮与目镜切换**：滤镜组支持 M-A/M-B 三态协议控制（M01/M02/M03），排查并解决了目镜切换异常问题 (#10006)。
- **MCU 固件分层架构**：分层重构 RV1103b-Cool-Camera-MCU 固件，实现了底层驱动与应用通讯协议的解耦 (#10200)。

## 3. 关联工单与里程碑
- **#10006**：目镜切换异常
- **#10009**：整理服务器冷冻相机环境
- **#10094**：滤镜切换器
- **#10170**：585照片不正常
- **#10200**：分层重构 RV1103b-Cool-Camera-MCU 固件初版
`,
    keyModules: [
      {
        name: "TEC 制冷闭环驱动",
        description: "半导体制冷与 NTC DMA 平均温度采样滤波",
      },
      { name: "滤镜轮与目镜切换", description: "三态切换协议与防卡死光学控制" },
      {
        name: "RV1103b MCU 固件",
        description: "固件分层解耦与高精度温度控制帧协议",
      },
    ],
    relatedTickets: [
      { ticketNo: 10006, title: "目镜切换异常" },
      { ticketNo: 10009, title: "整理服务器冷冻相机环境" },
      { ticketNo: 10094, title: "滤镜切换器" },
      { ticketNo: 10170, title: "585照片不正常" },
      { ticketNo: 10200, title: "分层重构 RV1103b-Cool-Camera-MCU 固件初版" },
    ],
    sourceEvidence: [
      {
        id: "cmpm6subi0003jlordbq7q56s",
        type: "ticket",
        title: "#10006 目镜切换异常",
        url: "/tickets/cmpm6subi0003jlordbq7q56s",
      },
      {
        id: "cmpngebr30004jl1y1zapu1od",
        type: "ticket",
        title: "#10009 整理服务器冷冻相机环境",
        url: "/tickets/cmpngebr30004jl1y1zapu1od",
      },
    ],
    version: 1,
    generatedAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  },
  {
    id: "wiki_telescope",
    slug: "project-telescope",
    title: "《寻星望远镜 项目研发全貌与技术架构总览》",
    category: "project_overview",
    projectId: "cmpm5ywfh0001jl5afcvpw3u7",
    projectName: "寻星望远镜",
    summary:
      "寻星望远镜是集成了高精度双轴电动经纬仪、星图识别与自动对准寻星算法的智能天文望远镜，基于 RK_EVB1 RV1126B 平台与 Unity 客户端驱动。",
    content: `# 《寻星望远镜 项目研发全貌与技术架构总览》

## 1. 项目定位与核心能力
寻星望远镜旨在让天文摄影爱好者一键完成找星、校准与自动跟踪。硬件主控搭载瑞芯微 RV1126B 与 CH585M 蓝牙芯片，软件配备 Unity 研发的跨平台 StarMapScreen 星图客户端。

## 2. 核心技术模块
- **双轴电动经纬仪 (MountControl)**：MountControlHandler 驱动步进电机进行赤经、赤纬双轴微步驱动，支持一键串口自动归零操作。
- **Unity 交互系统与星图 HUD**：StarMapScreen 整合实时天体轨迹、HUD 可见性控制与射线碰撞检测 (#10013)。
- **硬件平台架构**：主板采用 RK_EVB1_RV1126B_DDR4 评估板及 CH585M 芯片，支持无线低功耗对齐。

## 3. 关联工单与里程碑
- **#10007**：拍摄模式
- **#10013**：unity主页面与 Figma 纹理导入
- **#10061**：7.1路演前需求与望远镜归零功能
`,
    keyModules: [
      {
        name: "电动经纬仪驱动",
        description: "双轴电机 UART 闭环微调与自动归零算法",
      },
      {
        name: "Unity 星图客户端",
        description: "StarMapScreen 跨平台交互与天体轨迹运算",
      },
      {
        name: "主控与通信硬件",
        description: "RV1126B DDR4 主板与 CH585M 芯片通信",
      },
    ],
    relatedTickets: [
      { ticketNo: 10007, title: "拍摄模式" },
      { ticketNo: 10013, title: "unity主页面" },
      { ticketNo: 10061, title: "7.1路演前需求" },
    ],
    sourceEvidence: [
      {
        id: "cmppb0sco000mjlbe79sykpvv",
        type: "ticket",
        title: "#10013 unity主页面",
        url: "/tickets/cmppb0sco000mjlbe79sykpvv",
      },
      {
        id: "cmqakvgos003zjly8ecek4ji4",
        type: "note",
        title: "经纬仪文档",
        url: "/pkm/notes/cmqakvgos003zjly8ecek4ji4",
      },
      {
        id: "cmq6ghljh0001jln98ih58my0",
        type: "note",
        title: "CH585M芯片手册",
        url: "/pkm/notes/cmq6ghljh0001jln98ih58my0",
      },
    ],
    version: 1,
    generatedAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  },
  {
    id: "wiki_light_pollution",
    slug: "project-light-pollution",
    title: "《光污染计 项目研发全貌与系统设计说明》",
    category: "project_overview",
    projectId: "cmpnrnpz60000jlbet29j87f5",
    projectName: "光污染计",
    summary:
      "光污染计（SQM）是便携式夜空天光亮度监测设备，采用高敏度光电放大链路与 BLE 无线数据广播，为天文观测选址提供客观量化等级数据。",
    content: `# 《光污染计 项目研发全貌与系统设计说明》

## 1. 项目定位与核心能力
光污染计用于量化夜空天光背景亮度（星等/平方角秒）。设备结构紧凑便携，一键开机即测，数据可通过蓝牙直连手机 APP 同步记录 GPS 与光污染等级。

## 2. 核心技术模块
- **光电放大与传感器校准**：光电二极管将极微弱天光光通量转换为差分电压信号，经多级温度补偿运算校准响应曲线 (#10018)。
- **BLE 通信与广播协议**：自定义广播服务 UUID，定期发送光照强度浮点数与电池电压。
- **结构与外壳防护**：机壳采用防水抗跌落工业设计，配有透光度校正滤光片。

## 3. 关联工单与文档
- **文档**：光污染设计需求文档
- **#10018**：光污染传感器校准工单
- **#10083**：xiu
`,
    keyModules: [
      {
        name: "光电二极管与模拟前端",
        description: "跨阻放大与低照度温度补偿采集",
      },
      { name: "BLE 蓝牙广播协议", description: "低功耗数据同步与测量帧广播" },
    ],
    relatedTickets: [
      { ticketNo: 10018, title: "光污染传感器校准" },
      { ticketNo: 10083, title: "xiu" },
    ],
    sourceEvidence: [
      {
        id: "note_light_doc",
        type: "note",
        title: "光污染设计需求文档",
        url: "/pkm/notes",
      },
      {
        id: "cmpov1btx0005jlbe1xe0ldlt",
        type: "project",
        title: "光污染计项目",
        url: "/projects/cmpnrnpz60000jlbet29j87f5",
      },
    ],
    version: 1,
    generatedAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  },
  {
    id: "wiki_rag_arch",
    slug: "arch-projecthub-rag",
    title: "《ProjectHub RAG 与图谱检索架构全貌》",
    category: "architecture_overview",
    summary:
      "ProjectHub 企业级检索架构，深度整合 PostgreSQL pm 业务表、pgvector 向量检索、知识图谱递归 CTE、三路 RRF 融合与本地轻量语义精排。",
    content: `# 《ProjectHub RAG 与图谱检索架构全貌》

## 1. 架构定位
系统面向软硬件研发管理与技术知识沉淀，构建了“原始事实 -> 拓扑关系 -> 综合知识”三层知识架构，提供高可靠、低延迟且可解释的问答检索服务。

## 2. 核心模块与链路
- **Query Understanding**：细粒度意图解析（12类）、站内范围防护（INTERNAL_ONLY）与数据库实体预绑定。
- **Retrieval Router**：根据查询计划裁决走 Structured / Hybrid / Graph / Wiki / MIX 选路，具备自动降级至 Hybrid 的安全网。
- **GraphRAG 拓扑遍历**：通过 PostgreSQL 递归 CTE 展开 1~2 跳关系链路，经由 KnowledgeNodeSource 映射回真实 SearchDocument。
- **Parent-Child 层次检索**：支持小切片语义精准召回，并向上展开带出父章节完整正文，消除上下文截断。
`,
    keyModules: [
      {
        name: "Query Understanding & Router",
        description: "意图分类、范围裁决与多路分流",
      },
      {
        name: "GraphRAG & RRF Fusion",
        description: "关系遍历与三路倒数排名融合算法",
      },
      {
        name: "Parent-Child & Reranker",
        description: "层次化展开与本地轻量语义精排",
      },
    ],
    relatedTickets: [],
    sourceEvidence: [
      {
        id: "cmq6b1z0d001fjl0bwr0of85b",
        type: "note",
        title: "现有 PKM 链路涉及的 schema、API、搜索与部署要点",
        url: "/pkm/notes/cmq6b1z0d001fjl0bwr0of85b",
      },
      {
        id: "cmq6g4ts500011jem3bxpvngv",
        type: "note",
        title: "向量搜索故障排查指南",
        url: "/pkm/notes/cmq6g4ts500011jem3bxpvngv",
      },
    ],
    version: 1,
    generatedAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  },
];

export function getWikiPageBySlug(slug: string): WikiPage | undefined {
  return WIKI_PAGES.find((p) => p.slug === slug);
}

export function listAllWikiPages(): WikiPage[] {
  return WIKI_PAGES;
}

export function findWikiPageByQuery(query: string): WikiPage | undefined {
  const q = query.trim().toLowerCase();
  // 1. Exact match on slug
  const bySlug = WIKI_PAGES.find((p) => p.slug.toLowerCase() === q);
  if (bySlug) return bySlug;

  // 2. Exact match on projectName
  const byProject = WIKI_PAGES.find(
    (p) => p.projectName && q.includes(p.projectName.toLowerCase()),
  );
  if (byProject) return byProject;

  // 3. Match on title substring
  const byTitle = WIKI_PAGES.find(
    (p) =>
      p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase()),
  );
  if (byTitle) return byTitle;

  // 4. Token overlap matching on title, slug, summary
  const queryTokens = q.split(/[\s,，、_—\-/]+/).filter((t) => t.length >= 2);
  let bestMatch: { page: WikiPage; score: number } | undefined;

  for (const page of WIKI_PAGES) {
    const pageText =
      `${page.title} ${page.slug} ${page.projectName ?? ""} ${page.summary}`.toLowerCase();
    const matchedCount = queryTokens.filter((t) => pageText.includes(t)).length;
    const score =
      queryTokens.length > 0 ? matchedCount / queryTokens.length : 0;
    if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { page, score };
    }
  }

  if (bestMatch) return bestMatch.page;
  return undefined;
}

import {
  synthesizeProjectWiki,
  syncWikiPageToSearchDocument,
  type WikiDatabaseClient,
} from "./wiki-synthesizer";
import { prisma } from "@/shared/db/client";

/**
 * Retrieves a wiki page from cache, SearchDocument, or dynamically synthesizes it from DB.
 */
export async function getOrSynthesizeWikiPage(
  query: string,
  options?: { db?: WikiDatabaseClient | typeof prisma },
): Promise<WikiPage | undefined> {
  // 1. Check in-memory / pre-seeded wiki pages
  const cached = findWikiPageByQuery(query);
  if (cached) return cached;

  const db = (options?.db ?? prisma) as WikiDatabaseClient & typeof prisma;

  // 2. Dynamic DB synthesis if project exists in database
  if (db.project) {
    try {
      const q = query.trim().toLowerCase();
      const project = (await db.project.findFirst?.({
        where: { name: { contains: q, mode: "insensitive" } },
        select: { id: true },
      })) as { id: string } | null;

      if (project) {
        const synthesized = await synthesizeProjectWiki(project.id, options);
        if (synthesized) {
          await syncWikiPageToSearchDocument(synthesized, options);
          return synthesized;
        }
      }
    } catch {
      /* ignore DB lookup error */
    }
  }

  return undefined;
}
