import { tool } from "ai";
import { z } from "zod";
import FirecrawlApp from "@mendable/firecrawl-js";

export const webScrape = tool({
  description:
    "爬取指定网页的完整内容，返回干净的 Markdown 格式。适用于已知道具体 URL、需要获取完整文章内容或技术文档的场景。",
  inputSchema: z.object({
    url: z.string().url("请提供有效的 URL"),
  }),
  execute: async ({ url }) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY not set");
    }

    const app = new FirecrawlApp({ apiKey });

    const response = await app.scrapeUrl(url, {
      formats: ["markdown"],
      onlyMainContent: true,
    });

    if (!response.success) {
      throw new Error(`Firecrawl scrape failed: ${response.error}`);
    }

    const data = response as {
      success: boolean;
      markdown?: string;
      metadata?: {
        title?: string;
        description?: string;
        language?: string;
      };
    };

    return {
      title: data.metadata?.title ?? "无标题",
      description: data.metadata?.description ?? "",
      language: data.metadata?.language ?? "zh",
      content: data.markdown ?? "",
      url,
    };
  },
});

export const webMap = tool({
  description:
    "发现网站结构，返回所有内部链接 sitemap。用于在爬取前了解网站有哪些页面可访问。",
  inputSchema: z.object({
    url: z.string().url("请提供有效的 URL"),
  }),
  execute: async ({ url }) => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY not set");
    }

    const app = new FirecrawlApp({ apiKey });

    const response = await app.mapUrl(url);

    if (!response.success) {
      throw new Error(`Firecrawl map failed: ${response.error}`);
    }

    return {
      links: response.links ?? [],
      count: (response.links ?? []).length,
      url,
    };
  },
});
