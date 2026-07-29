import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/shared/ui/AppShell";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { IconArrowLeft, IconKnowledge, IconTag } from "@/shared/ui/icons";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

type Params = { params: Promise<{ projectId: string; fileAssetId: string }> };

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  READY: { label: "已索引", tone: "bg-emerald-50 text-emerald-700" },
  PROCESSING: { label: "处理中", tone: "bg-amber-50 text-amber-700" },
  PENDING: { label: "等待中", tone: "bg-ink-100 text-ink-600" },
  FAILED: { label: "失败", tone: "bg-rose-50 text-rose-700" },
};

const STATUS_HINT: Record<string, string> = {
  // 格式解析失败（可由用户修复）
  PARSE_ERROR: "建议将文件转换为标准格式（如 docx/xlsx/pptx）后重新上传。",
  WPS_CONVERT_FAILED: "建议将 WPS 文件另存为 docx 格式后重新上传。",
  DOC_CONVERT_FAILED: "建议将 doc 文件另存为 docx 格式后重新上传。",
  // 提取为空（文件本身不适合 OCR）
  EXTRACTION_EMPTY: "文件可能为纯扫描件或图片，请确认文件内容后再试。",
  OCR_ERROR: "OCR 识别失败，请确认文件为可识别内容。",
  // 存储/服务端问题
  STORAGE_NOT_FOUND: "文件已被删除，请重新上传。",
  STORAGE_FETCH_FAILED: "存储服务异常，请稍后重试或联系管理员。",
  // 其他
  TIMEOUT: "文件可能过大，请尝试压缩或分割文件后重试。",
};

function getStatusHint(errorMessage: string): string | null {
  // errorMessage 格式：ERROR_CODE: 用户友好提示，或 ERROR_CODE: 详细描述
  const code = errorMessage.split(":")[0].trim().toUpperCase();
  // 只对可用户自助修复的错误给出提示
  const hints = Object.keys(STATUS_HINT);
  const match = hints.find((k) => code.includes(k));
  return match ? STATUS_HINT[match] : null;
}

export default async function ProjectDocumentDetailPage({ params }: Params) {
  await requireSession();
  const { projectId, fileAssetId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileAssetId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      status: true,
      createdAt: true,
      document: {
        select: {
          id: true,
          status: true,
          version: true,
          extractedText: true,
          pageCount: true,
          error: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!fileAsset || fileAsset.status === "DELETED") notFound();

  const document = fileAsset.document;
  const statusKey = document?.status ?? "PENDING";
  const statusInfo = STATUS_LABEL[statusKey] ?? STATUS_LABEL.PENDING;
  const extractedText = document?.extractedText ?? "";
  const errorMessage =
    document?.error && typeof document.error === "object" && "message" in (document.error as Record<string, unknown>)
      ? String((document.error as Record<string, unknown>).message)
      : null;

  return (
    <AppShell
      header={
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="返回项目详情"
          >
            <IconArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">
              {fileAsset.originalName}
            </h1>
            <p className="mt-0.5 truncate text-xs text-ink-400">
              {project.name} · 项目文档
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${statusInfo.tone}`}
            >
              {statusInfo.label}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-ink-600">
              <IconKnowledge className="h-3 w-3 text-ink-400" />
              {fileAsset.mimeType}
            </span>
            <span>{formatBytes(fileAsset.size)}</span>
            {document?.pageCount ? (
              <>
                <span>·</span>
                <span>{document.pageCount} 页</span>
              </>
            ) : null}
            <span>·</span>
            <span>上传于 {formatDate(fileAsset.createdAt)}</span>
            {document ? (
              <>
                <span>·</span>
                <span>索引版本 v{document.version}</span>
              </>
            ) : null}
          </div>

          {statusKey === "FAILED" && errorMessage ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <p className="font-medium">索引失败：{errorMessage}</p>
              {(() => {
                const hint = getStatusHint(errorMessage);
                return hint ? (
                  <p className="mt-1 text-rose-600">{hint}</p>
                ) : (
                  <p className="mt-1 text-rose-600">
                    请在 Worker 日志查看完整堆栈，或重新上传文件触发重处理。
                  </p>
                );
              })()}
            </div>
          ) : null}

          {statusKey !== "READY" && statusKey !== "FAILED" ? (
            <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs text-ink-500">
              文档正在处理中，正文将在 worker 完成后自动渲染。
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
          {extractedText ? (
            <div className="min-w-0">
              <MarkdownContent content={extractedText} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-ink-400">
              <IconTag className="h-6 w-6 text-ink-300" />
              <p>暂无正文内容</p>
              <p className="text-xs text-ink-300">
                若文档为图片/PDF，请确认 OCR 服务可用；若为文本文件，请确认 Worker 已完成提取。
              </p>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
          <h2 className="text-sm font-semibold text-ink-700">附件原文件</h2>
          <p className="mt-1 text-xs text-ink-400">
            仅做下载参考，正文以上方提取后的 Markdown 为准。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <a
              href={`/api/upload/${fileAsset.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 font-medium text-brand-700 hover:bg-brand-100"
            >
              下载 {fileAsset.originalName}
            </a>
            <span className="text-ink-400">{formatBytes(fileAsset.size)}</span>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
