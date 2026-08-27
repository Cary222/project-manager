"use client";

import React, { useMemo } from "react";
import { AnsiUp } from "ansi_up";

/**
 * Renders ANSI SGR escape sequences (as emitted by pi extension widgets such
 * as pi-lens / nano-context / rpiv-todo) as colored/styled React elements.
 *
 * Uses `ansi_up` to generate HTML, then safely parses spans into React elements
 * to eliminate raw innerHTML injection risks.
 */

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseStyleString(styleStr: string): React.CSSProperties {
  const style: Record<string, string> = {};
  const declarations = styleStr.split(";");
  for (const decl of declarations) {
    const colonIdx = decl.indexOf(":");
    if (colonIdx > 0) {
      const prop = decl.slice(0, colonIdx).trim();
      const val = decl.slice(colonIdx + 1).trim();
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      style[camelProp] = val;
    }
  }
  return style;
}

export function AnsiText({ text }: { text: string }) {
  const elements = useMemo(() => {
    const html = new AnsiUp().ansi_to_html(text);
    const regex = /<span style="([^"]*)">([\s\S]*?)<\/span>|([^<]+)/g;
    const items: React.ReactNode[] = [];
    let match: RegExpExecArray | null = regex.exec(html);
    let index = 0;

    while (match !== null) {
      if (match[1] !== undefined && match[2] !== undefined) {
        const decoded = decodeHtmlEntities(match[2]);
        const style = parseStyleString(match[1]);
        items.push(
          <span key={index++} style={style}>
            {decoded}
          </span>,
        );
      } else if (match[3]) {
        const decoded = decodeHtmlEntities(match[3]);
        items.push(<span key={index++}>{decoded}</span>);
      }
      match = regex.exec(html);
    }
    return items.length > 0 ? items : [text];
  }, [text]);

  return <span>{elements}</span>;
}
