/**
 * SandboxedIframe - React component for secure HTML/SVG rendering
 * Adapted from pi-web-ui Lit component to React
 */

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { RUNTIME_MESSAGE_ROUTER } from "./RuntimeMessageRouter";
import type { MessageConsumer } from "./RuntimeMessageRouter";
import { generateBridgeCode } from "./RuntimeMessageBridge";
import { ConsoleRuntimeProvider } from "./ConsoleRuntimeProvider";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider";

export interface SandboxFile {
  fileName: string;
  content: string | Uint8Array;
  mimeType: string;
}

export interface SandboxResult {
  success: boolean;
  console: Array<{ type: string; text: string }>;
  files?: SandboxFile[];
  error?: { message: string; stack: string };
  returnValue?: unknown;
}

export interface SandboxedIframeProps {
  /** Unique ID for this sandbox */
  sandboxId: string;
  /** HTML content to render */
  html?: string;
  /** Additional runtime providers */
  providers?: SandboxRuntimeProvider[];
  /** Custom className */
  className?: string;
  /** Sandbox attribute (default: allow-scripts) */
  sandbox?: string;
  /** Callback when console message received */
  onConsole?: (entry: { type: string; text: string }) => void;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
  /** Callback when sandbox reports an error */
  onSandboxError?: (error: { message: string; stack: string }) => void;
  /** Initial content set flag */
  initialContent?: boolean;
}

/**
 * Escape HTML special sequences in code to prevent premature tag closure
 */
function escapeScriptContent(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * Validate HTML using DOMParser
 */
function validateHtml(html: string): string | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      return parserError.textContent || "Unknown parse error";
    }
    return null;
  } catch (error) {
    return (error as Error).message || "Unknown validation error";
  }
}

/**
 * Generate runtime script for the sandbox
 */
function generateRuntimeScript(
  sandboxId: string,
  providers: SandboxRuntimeProvider[],
  isStandalone: boolean = false
): string {
  // Collect data from providers
  const allData: Record<string, unknown> = {};
  for (const provider of providers) {
    Object.assign(allData, provider.getData());
  }

  // Generate bridge code
  const bridgeCode = isStandalone
    ? ""
    : generateBridgeCode({ context: "sandbox-iframe", sandboxId });

  // Generate runtime functions
  const runtimeFunctions: string[] = [];
  for (const provider of providers) {
    const runtime = provider.getRuntime();
    runtimeFunctions.push(`(${runtime.toString()})(${JSON.stringify(sandboxId)});`);
  }

  // Build data injection
  const dataInjection = Object.entries(allData)
    .map(([key, value]) => {
      const jsonStr = JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
      return `window.${key} = ${jsonStr};`;
    })
    .join("\n");

  // Navigation interceptor
  const navigationInterceptor = isStandalone
    ? ""
    : `
// Navigation interceptor
(function() {
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (link && link.href) {
      if (link.href.startsWith('http://') || link.href.startsWith('https://')) {
        e.preventDefault();
        e.stopPropagation();
        window.parent.postMessage({ type: 'open-external-url', url: link.href }, '*');
      }
    }
  }, true);

  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form && form.action) {
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ type: 'open-external-url', url: form.action }, '*');
    }
  }, true);
})();
`;

  return `<style>
html, body { font-size: initial; }
</style>
<script>
window.sandboxId = ${JSON.stringify(sandboxId)};
${dataInjection}
${bridgeCode}
${runtimeFunctions.join("\n")}
${navigationInterceptor}
</script>`;
}

/**
 * Prepare complete HTML document with runtime
 */
function prepareHtmlDocument(
  sandboxId: string,
  userCode: string,
  providers: SandboxRuntimeProvider[],
  options: { isHtmlArtifact: boolean; isStandalone?: boolean } = { isHtmlArtifact: false }
): string {
  const opts = {
    ...options,
    isHtmlArtifact: options.isHtmlArtifact ?? false,
    isStandalone: options.isStandalone ?? false,
  };

  const runtime = generateRuntimeScript(sandboxId, providers, opts.isStandalone);

  if (opts.isHtmlArtifact) {
    // HTML Artifact - inject runtime into existing HTML
    const headMatch = userCode.match(/<head[^>]*>/i);
    if (headMatch) {
      const index = headMatch.index! + headMatch[0].length;
      return userCode.slice(0, index) + runtime + userCode.slice(index);
    }

    const htmlMatch = userCode.match(/<html[^>]*>/i);
    if (htmlMatch) {
      const index = htmlMatch.index! + htmlMatch[0].length;
      return userCode.slice(0, index) + runtime + userCode.slice(index);
    }

    // Fallback: prepend runtime
    return runtime + userCode;
  } else {
    // REPL - wrap code in HTML
    const escapedUserCode = escapeScriptContent(userCode);

    return `<!DOCTYPE html>
<html>
<head>
  ${runtime}
</head>
<body>
  <script type="module">
    (async () => {
      try {
        const userCodeFunc = async () => {
          ${escapedUserCode}
        };
        const returnValue = await userCodeFunc();
        if (window.__completionCallbacks && window.__completionCallbacks.length > 0) {
          await Promise.all(window.__completionCallbacks.map(cb => cb(true)));
        }
        await window.complete(null, returnValue);
      } catch (error) {
        if (window.__completionCallbacks && window.__completionCallbacks.length > 0) {
          await Promise.all(window.__completionCallbacks.map(cb => cb(false)));
        }
        await window.complete({
          message: error?.message || String(error),
          stack: error?.stack || new Error().stack
        });
      }
    })();
  </script>
</body>
</html>`;
  }
}

export function SandboxedIframe({
  sandboxId,
  html = "",
  providers: additionalProviders = [],
  className = "",
  sandbox = "allow-scripts allow-modals",
  onConsole,
  onError,
  onSandboxError,
}: SandboxedIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Create providers with console provider
  const consoleProviderRef = useRef(new ConsoleRuntimeProvider());
  const providers = [consoleProviderRef.current, ...additionalProviders];

  // Setup message consumer for console and errors
  useEffect(() => {
    const consumer: MessageConsumer = {
      handleMessage: async (message: unknown) => {
        const msg = message as { type?: string; level?: string; text?: string; error?: { message: string; stack: string } };

        if (msg.type === "console" && msg.level && msg.text) {
          consoleProviderRef.current.addLog({ type: msg.level, text: msg.text });
          onConsole?.({ type: msg.level, text: msg.text });
        } else if (msg.type === "execution-error" && msg.error) {
          onSandboxError?.(msg.error);
        }
      },
    };

    RUNTIME_MESSAGE_ROUTER.registerSandbox(sandboxId, providers, [consumer]);
    RUNTIME_MESSAGE_ROUTER.setSandboxIframe(sandboxId, iframeRef.current!);

    return () => {
      RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
    };
  }, [sandboxId, providers, onConsole, onSandboxError]);

  // Load content into iframe
  useEffect(() => {
    if (!html || !iframeRef.current) return;

    const completeHtml = prepareHtmlDocument(sandboxId, html, providers, {
      isHtmlArtifact: true,
      isStandalone: false,
    });

    // Validate before loading
    const validationError = validateHtml(completeHtml);
    if (validationError) {
      console.error("HTML validation failed:", validationError);
      onError?.(new Error(`HTML validation failed: ${validationError}`));
      return;
    }

    const iframe = iframeRef.current;
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(completeHtml);
      doc.close();
    }

    setIsLoaded(true);
  }, [html, sandboxId, onError]);

  // Handle iframe load
  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  // Handle iframe error
  const handleError = useCallback(() => {
    onError?.(new Error("Failed to load iframe content"));
  }, [onError]);

  return (
    <iframe
      ref={iframeRef}
      className={`w-full h-full border-0 ${className}`}
      sandbox={sandbox}
      title={`Sandboxed content: ${sandboxId}`}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

export { RUNTIME_MESSAGE_ROUTER } from "./RuntimeMessageRouter";
export { generateBridgeCode } from "./RuntimeMessageBridge";
export { ConsoleRuntimeProvider } from "./ConsoleRuntimeProvider";
export type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider";
