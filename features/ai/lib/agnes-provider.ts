import { createOpenAI } from "@ai-sdk/openai";

export const agnes = createOpenAI({
  baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

export const agnesFlash = agnes.chat("agnes-2.0-flash");
