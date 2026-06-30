/**
 * shared/lib/xss.ts
 *
 * PR7 新增：从 app/reports/weekly-reports/[id]/page.tsx 抽取的共享 XSS 工具。
 *
 * 风险：Agnes LLM 是外部 API，理论上可被 prompt injection 污染输出。
 * 如果直接 `dangerouslySetInnerHTML` 原文，`<img onerror=alert('XSS')>`
 * 这种内容会被浏览器执行 → Stored XSS。
 *
 * 策略：先转义危险字符（& < > " ' /），再还原 markdown 标记（**bold** / *italic*）。
 * 这样 LLM 输出的 `<script>` 会被显示成文本，而不是被执行。
 */
export function escapeAiSummary(aiSummary: string | null | undefined): string {
  if (!aiSummary) return "";
  return aiSummary
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}
