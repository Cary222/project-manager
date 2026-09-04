"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const ALLOWED_URL_PROTOCOLS = ["http:", "https:", "mailto:"];
const ALLOWED_DATA_PREFIX = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i;

function safeUrlTransform(url: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (trimmed.toLowerCase().startsWith("data:")) {
    return ALLOWED_DATA_PREFIX.test(trimmed) ? trimmed : "";
  }
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
      return "";
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = src;
    a.download = alt || "image";
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button
        className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
        title="下载图片"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: "default" }}
      />
    </div>
  );
}

type MarkdownContentProps = {
  content: string;
  collapsible?: boolean;
  collapsedHeight?: number;
  mentionMap?: Record<string, { id: string; name: string }>;
};

function CollapsedOverlay({ onClick }: { onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center">
      <div className="h-12 w-full bg-gradient-to-t from-white to-transparent" />
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto relative -mt-8 flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-1.5 text-sm font-medium text-ink-600 shadow-md hover:bg-ink-50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        展开正文
      </button>
    </div>
  );
}

export function MarkdownContent({ content, collapsible = false, collapsedHeight = 200, mentionMap }: MarkdownContentProps) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [expanded, setExpanded] = useState(!collapsible);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const openLightbox = useCallback((src: string, alt: string) => {
    setLightbox({ src, alt });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  useEffect(() => {
    if (!collapsible) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setIsOverflowing(el.scrollHeight > collapsedHeight);
    });
    ro.observe(el);
    setIsOverflowing(el.scrollHeight > collapsedHeight);
    return () => ro.disconnect();
  }, [collapsible, collapsedHeight, content]);

  const needsCollapse = collapsible && isOverflowing && !expanded;

  const containerStyle = needsCollapse
    ? { maxHeight: collapsedHeight, overflow: "hidden", position: "relative" as const }
    : undefined;

  return (
    <>
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />}
      <div ref={containerRef} style={containerStyle} className="min-w-0 overflow-hidden">
        <div className="min-w-0 break-words text-sm leading-6 text-ink-700
          [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-ink-900
          [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900
          [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink-900
          [&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-ink-900
          [&_h5]:mt-3 [&_h5]:mb-1.5 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-ink-900
          [&_h6]:mt-3 [&_h6]:mb-1.5 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-ink-700
          [&_p]:my-3 [&_p]:first:mt-0 [&_p]:last:mb-0
          [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
          [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
          [&_li]:my-1 [&_li]:leading-6
          [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-ink-300 [&_blockquote]:bg-ink-100 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-ink-700
          [&_strong]:font-semibold [&_strong]:text-ink-900
          [&_em]:italic
          [&_del]:text-ink-400 [&_del]:line-through
          [&_hr]:my-5 [&_hr]:border-ink-200
          [&_code]:rounded [&_code]:bg-ink-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-ink-900 [&_code]:before:content-none [&_code]:after:content-none
          [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-ink-200 [&_pre]:bg-ink-100 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5
          [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink-900
          [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:rounded-lg [&_table]:border [&_table]:border-ink-200
          [&_th]:border [&_th]:border-ink-200 [&_th]:bg-ink-100 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink-900
          [&_td]:border [&_td]:border-ink-200 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:text-ink-700
          [&_img]:my-3 [&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-ink-200 [&_img]:object-contain
          [&_a]:text-brand-600 [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 [&_a]:hover:text-brand-700">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            urlTransform={safeUrlTransform}
            components={{
              img: ({ src, alt }) => {
                const srcStr = typeof src === "string" ? src : "";
                if (!srcStr) return null;
                const altStr = String(alt ?? "");
                return (
                   
                  <a
                    href={srcStr}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      openLightbox(srcStr, altStr);
                    }}
                    className="inline-block"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={srcStr}
                      alt={altStr}
                      className="max-h-[520px] max-w-full cursor-zoom-in rounded-lg border border-zinc-200 object-contain"
                    />
                  </a>
                );
              },
              a: ({ href, children, ...rest }) => {
                const hrefStr = typeof href === "string" ? href : "";
                if (!hrefStr) return <>{children}</>;

                if (mentionMap && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hrefStr)) {
                  const mapped = mentionMap[hrefStr.toLowerCase()];
                  if (mapped) {
                    return (
                      <Link
                        href={`/team/${mapped.id}`}
                        className="rounded bg-brand-50 px-1 text-brand-700 hover:bg-brand-100 hover:text-brand-800"
                        {...rest}
                      >
                        {children}
                      </Link>
                    );
                  }
                }

                if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hrefStr)) {
                  return (
                    <a
                      href={`mailto:${hrefStr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700"
                      {...rest}
                    >
                      {children}
                    </a>
                  );
                }

                return (
                  <a
                    href={hrefStr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700"
                    {...rest}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {needsCollapse && (
          <CollapsedOverlay onClick={() => setExpanded(true)} />
        )}
      </div>
    </>
  );
}
