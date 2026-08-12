import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/shared/lib/permissions";
import { transcribeWithDashScope } from "@/features/ai/audio/stt/dashscope";

const TranscribeSchema = z.object({
  audio: z.string(), // base64 编码的音频数据
  format: z.enum(["webm", "mp4", "wav"]),
  model: z.string().optional(),
});

/**
 * POST /api/ai/audio/transcribe
 *
 * 语音识别 API
 * - 接受 base64 编码的音频数据和格式
 * - 调用 DashScope ASR 进行识别
 * - 返回识别结果
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    const userId = session.user.id;

    const body = await request.json();
    const { audio, format, model } = TranscribeSchema.parse(body);

    // 解码 base64 音频数据
    const audioBuffer = Buffer.from(audio, "base64");

    // 调用语音识别
    const result = await transcribeWithDashScope(audioBuffer, format, {
      userId,
      model,
    });

    return NextResponse.json({
      data: result,
      error: null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    if (message === "UNAUTHORIZED") {
      return NextResponse.json(
        { data: null, error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { data: null, error: message },
      { status: 500 }
    );
  }
}
