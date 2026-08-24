import { NextResponse } from "next/server";
import { getSessionEntries, resolveSessionPath } from "@/lib/session-reader";

/**
 * GET /api/sessions/[id]/entries/[entryId]/thinking?blockIndex=N
 *
 * 刷新页面后，会话历史中的 thinking 块以 deferred 形式加载（thinking 内容置空、
 * deferred: true），点击「思考」时由前端 loadThinkingContent() 发起本请求，
 * 从会话 JSONL 文件中按 entryId + blockIndex 取回原始 thinking 文本。
 *
 * 参考 pi-web-ref（~/workstation/pi-web-ref）的同名实现；
 * 本项目的 getSessionEntries 为 async，需 await。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  }

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    // SessionManager-backed parsing preserves the SDK's malformed-line tolerance.
    const entries = await getSessionEntries(filePath);
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") {
      return NextResponse.json({ error: "Assistant message not found" }, { status: 404 });
    }

    const block = entry.message.content[blockIndex];
    if (!block || block.type !== "thinking") {
      return NextResponse.json({ error: "Thinking block not found" }, { status: 404 });
    }

    return NextResponse.json({ thinking: block.thinking });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}