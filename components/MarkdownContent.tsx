"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const safeUrlTransform = (url: string) => url;

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

export function MarkdownContent({ content, collapsible = false, collapsedHeight = 200 }: MarkdownContentProps) {
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
        <div className="min-w-0 space-y-3 break-words text-sm leading-6 text-zinc-700 [&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-zinc-200 [&_img]:object-contain [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
          <ReactMarkdown
            urlTransform={safeUrlTransform}
            components={{
              img: ({ src, alt }) => {
                const srcStr = typeof src === "string" ? src : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={srcStr}
                    alt={String(alt ?? "")}
                    className="max-h-[520px] max-w-full rounded-lg border border-zinc-200 object-contain"
                    onClick={() => { if (srcStr) openLightbox(srcStr, String(alt ?? "")); }}
                    style={{ cursor: "zoom-in" }}
                  />
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
