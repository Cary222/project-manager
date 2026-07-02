import { tool } from "ai";
import { z } from "zod";
import { retrieveContext } from "@/features/ai/lib/rag";

const toolContextSchema = z.object({
  viewerUserId: z.string().nullable(),
});

type ToolContext = z.infer<typeof toolContextSchema>;

export const searchKnowledge = tool({
  description: "在 ProjectHub 知识库（工单/提交/笔记）语义检索。",
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  contextSchema: toolContextSchema,
  execute: async ({ query, limit }, options) => {
    const ctx = (options?.context ?? { viewerUserId: null }) as ToolContext;
    return await retrieveContext(query, {
      limit,
      userId: ctx.viewerUserId,
    });
  },
});
