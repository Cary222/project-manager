/**
 * XSS utilities for escaping AI-generated content.
 *
 * Risk: Agnes LLM is an external API, theoretically susceptible to prompt injection.
 * Directly using `dangerouslySetInnerHTML` with the original text means `<img onerror=alert('XSS')>`
 * would be executed by the browser → Stored XSS.
 *
 * Strategy: First escape dangerous characters (& < > " ' /), then restore markdown markers (**bold** / *italic*).
 * This way, `<script>` output from LLM is displayed as text rather than executed.
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
