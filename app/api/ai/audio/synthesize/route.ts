/**
 * /api/ai/audio/synthesize — TTS 语音合成 API
 *
 * POST 请求，接收文本并返回合成的音频
 *
 * Body: { text: string, voice?: string }
 * Response: audio/mp3
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { synthesizeWithDashScope } from "@/features/ai/llm/providers/audio/tts/dashscope";
import { z } from "zod";

const synthesizeSchema = z.object({
  text: z.string().min(1, "文本内容不能为空").max(500, "文本内容不能超过 500 字"),
  voice: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const { text, voice } = synthesizeSchema.parse(body);

    const result = await synthesizeWithDashScope(session.user.id, text, {
      voice,
    });

    // Uint8Array → ArrayBuffer → Response
    const arrayBuffer = result.audio.buffer.slice(
      result.audio.byteOffset,
      result.audio.byteOffset + result.audio.byteLength
    ) as ArrayBuffer;

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mp3",
        "Content-Length": result.audio.byteLength.toString(),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    if (error instanceof Error) {
      // 凭证未配置
      if (error.message.includes("凭证未配置") || error.message.includes("API Key")) {
        return NextResponse.json(
          { error: "DashScope API Key 未配置，请在设置中添加" },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
