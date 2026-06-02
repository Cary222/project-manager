"use client";

import { useCallback, useState } from "react";
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

export function MarkdownContent({ content }: { content: string }) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const openLightbox = useCallback((src: string, alt: string) => {
    setLightbox({ src, alt });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
  }, []);

  return (
    <>
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />}
      <div className="space-y-3 text-sm leading-6 text-zinc-700 [&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-zinc-200 [&_img]:object-contain">
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
                  className="[&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-zinc-200 [&_img]:object-contain"
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
    </>
  );
}
