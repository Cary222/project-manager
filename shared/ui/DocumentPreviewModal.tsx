"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";

export type PreviewableFile = {
  name: string;
  url: string;
  mimeType: string;
};

interface Props {
  file: PreviewableFile | null;
  onClose: () => void;
}

export function DocumentPreviewModal({ file, onClose }: Props) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setContent(null);
      setPdfNumPages(null);
      setPdfUrl(null);
      setPdfLoadError(null);
      return;
    }

    const isPdf = file.mimeType === "application/pdf";
    const isDocx =
      file.mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isImage = file.mimeType.startsWith("image/");
    const isMarkdown =
      file.mimeType === "text/markdown" || file.mimeType === "text/x-markdown";

    if (isImage) {
      setContent(
        <div className="flex justify-center">
          <img
            src={file.url}
            alt={file.name}
            className="max-h-[70vh] rounded-lg object-contain"
          />
        </div>,
      );
      return;
    }

    if (isPdf) {
      import("react-pdf")
        .then(async ({ pdfjs }) => {
          // react-pdf 10 在 dev 模式（Next.js 16 + webpack 5.98）下会因为
          // eval-source-map 与 pdfjs-dist ESM 互操作不兼容，抛
          //   "Object.defineProperty called on non-object"。
          // 已知修复：把 pdf.worker 放到 public/ 下，用绝对路径加载，
          // 绕过 webpack 对 worker chunk 的 ESM 互操作（参考
          // https://github.com/mozilla/pdf.js/issues/20478
          // https://github.com/vercel/next.js/issues/89177）。
          try {
            pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          } catch (err) {
            console.error("[DocumentPreviewModal] failed to set workerSrc", err);
          }

          setPdfNumPages(null);
          setPdfLoadError(null);
          setPdfUrl(file.url);
        })
        .catch((err: unknown) => {
          console.error("[DocumentPreviewModal] react-pdf dynamic import failed", err);
          setContent(
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              PDF 预览组件加载失败，请尝试下载查看
            </div>,
          );
        });
      return;
    }

    if (isDocx) {
      fetch(file.url)
        .then((r) => r.arrayBuffer())
        .then((buf) =>
          import("mammoth/mammoth.browser").then((mod) => {
            const convertToHtml =
              (mod as unknown as {
                convertToHtml?: (opts: {
                  arrayBuffer: ArrayBuffer;
                }) => Promise<{ value: string; messages: unknown[] }>;
              }).convertToHtml ??
              (mod as unknown as {
                default?: {
                  convertToHtml?: (opts: {
                    arrayBuffer: ArrayBuffer;
                  }) => Promise<{ value: string; messages: unknown[] }>;
                };
              }).default?.convertToHtml;

            if (!convertToHtml) {
              setContent(
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  mammoth 加载失败，无法预览该文档
                </div>,
              );
              return;
            }

            convertToHtml({ arrayBuffer: buf })
              .then(({ value, messages }) => {
                if (messages && messages.length > 0) {
                  console.warn(
                    "[DocumentPreviewModal] mammoth messages",
                    messages,
                  );
                }
                if (!value.trim()) {
                  setContent(
                    <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
                      文档内容为空
                    </div>,
                  );
                  return;
                }
                // mammoth 输出的是 clean HTML（不含 <script>），可以直接渲染。
                // 表格默认没有边框/对齐样式，我们用一层 .docx-preview 容器配
                // 局部 CSS 补上表格的视觉结构。
                setContent(
                  <div
                    className="docx-preview max-h-[70vh] overflow-auto rounded-lg border border-ink-200 bg-white p-6 text-sm leading-relaxed text-ink-800"
                    dangerouslySetInnerHTML={{ __html: value }}
                  />,
                );
              })
              .catch((err: unknown) => {
                console.error("[DocumentPreviewModal] convertToHtml failed", err);
                setContent(
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    文档解析失败，请尝试下载查看
                  </div>,
                );
              });
          }),
        )
        .catch((err: unknown) => {
          console.error("[DocumentPreviewModal] fetch docx failed", err);
          setContent(
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              文档下载失败，请稍后重试
            </div>,
          );
        });
      return;
    }

    if (isMarkdown) {
      fetch(file.url)
        .then((r) => r.text())
        .then((text) => {
          if (!text.trim()) {
            setContent(
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-4 text-sm text-ink-700">
                文档内容为空
              </div>,
            );
            return;
          }
          setContent(
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-ink-200 bg-white p-6 text-sm leading-relaxed text-ink-800">
              <MarkdownContent content={text} />
            </div>,
          );
        })
        .catch((err: unknown) => {
          console.error("[DocumentPreviewModal] fetch markdown failed", err);
          setContent(
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              文档下载失败，请稍后重试
            </div>,
          );
        });
      return;
    }

    setContent(
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-ink-500">暂不支持预览此格式，可下载查看</p>
        <a
          href={file.url}
          download={file.name}
          className="rounded-lg bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
        >
          下载文件
        </a>
      </div>,
    );
  }, [file]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!file) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[85vh] w-[820px] max-w-[90vw] flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-5 py-3">
          <h3 className="truncate pr-4 text-sm font-semibold text-ink-900">
            {file.name}
          </h3>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={file.url}
              download={file.name}
              className="rounded-lg border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:bg-ink-50"
            >
              下载
            </a>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-ink-100"
              aria-label="关闭"
            >
              <svg
                className="h-5 w-5 text-ink-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {pdfUrl ? (
            <PdfViewer
              url={pdfUrl}
              numPages={pdfNumPages}
              onNumPages={setPdfNumPages}
              onError={setPdfLoadError}
            />
          ) : (
            content ?? (
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              </div>
            )
          )}
          {pdfLoadError ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {pdfLoadError}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface PdfViewerProps {
  url: string;
  numPages: number | null;
  onNumPages: (n: number) => void;
  onError: (msg: string) => void;
}

function PdfViewer({ url, numPages, onNumPages, onError }: PdfViewerProps) {
  const [DocumentComp, setDocumentComp] = useState<React.ComponentType<{
    file: string;
    onLoadSuccess?: (data: { numPages: number }) => void;
    onLoadError?: (err: unknown) => void;
    loading?: React.ReactNode;
    error?: React.ReactNode;
    children?: React.ReactNode;
  }> | null>(null);
  const [PageComp, setPageComp] = useState<React.ComponentType<{
    pageNumber: number;
    width?: number;
    renderTextLayer?: boolean;
    renderAnnotationLayer?: boolean;
  }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("react-pdf")
      .then(({ Document, Page }) => {
        if (cancelled) return;
        setDocumentComp(() => Document);
        setPageComp(() => Page);
      })
      .catch((err: unknown) => {
        console.error("[DocumentPreviewModal] react-pdf dynamic import failed", err);
        if (!cancelled) {
          onError("PDF 预览组件加载失败，请尝试下载查看");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  if (!DocumentComp || !PageComp) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  const pages =
    numPages && numPages > 0
      ? Array.from({ length: numPages }, (_, i) => (
          <PageComp
            key={i + 1}
            pageNumber={i + 1}
            width={760}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        ))
      : null;

  return (
    <DocumentComp
      file={url}
      onLoadSuccess={(data) => onNumPages(data.numPages)}
      onLoadError={(err) => {
        console.error("[DocumentPreviewModal] PDF load error", err);
        onError("PDF 加载失败，请尝试下载查看");
      }}
      loading={
        <div className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        </div>
      }
      error={
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          PDF 加载失败，请尝试下载查看
        </div>
      }
    >
      {pages}
    </DocumentComp>
  );
}
