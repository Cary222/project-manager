import { tool } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";

export const webSearch = tool({
  description: "搜索互联网获取实时信息。",
  inputSchema: z.object({
    query: z.string().min(2).max(200),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY not set");
    const client = tavily({ apiKey });
    const res = await client.search(query, { searchDepth: "basic", maxResults });
    return {
      results: res.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
      answer: res.answer,
    };
  },
});
