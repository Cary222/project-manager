/**
 * Console Runtime Provider
 * Captures console output from sandboxed iframes
 */

import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider";

export interface ConsoleEntry {
  type: string;
  text: string;
}

export class ConsoleRuntimeProvider implements SandboxRuntimeProvider {
  private logs: ConsoleEntry[] = [];

  getData(): Record<string, unknown> {
    return {
      __consoleLogs: this.logs,
    };
  }

  getRuntime(): (sandboxId: string) => void {
    return (sandboxId: string) => {
      const originalConsole = {
        log: window.console.log,
        error: window.console.error,
        warn: window.console.warn,
        info: window.console.info,
      };

      const sendLog = (type: string, ...args: unknown[]) => {
        const text = args.map((a) => {
          if (typeof a === "object") {
            try {
              return JSON.stringify(a, null, 2);
            } catch {
              return String(a);
            }
          }
          return String(a);
        }).join(" ");

        window.parent.postMessage(
          {
            type: "console",
            sandboxId,
            level: type,
            text,
          },
          "*"
        );

        // Also call original console
        originalConsole[type as keyof typeof originalConsole]?.(text);
      };

      window.console.log = (...args: unknown[]) => sendLog("log", ...args);
      window.console.error = (...args: unknown[]) => sendLog("error", ...args);
      window.console.warn = (...args: unknown[]) => sendLog("warn", ...args);
      window.console.info = (...args: unknown[]) => sendLog("info", ...args);

      // Capture unhandled errors
      window.onerror = (msg, _src, _line, _col, error?: Error) => {
        window.parent.postMessage(
          {
            type: "console",
            sandboxId,
            level: "error",
            text: error ? `${msg}\n${error.stack}` : String(msg),
          },
          "*"
        );
        return true;
      };

      // Capture unhandled promise rejections
      window.onunhandledrejection = (event) => {
        window.parent.postMessage(
          {
            type: "console",
            sandboxId,
            level: "error",
            text: `Unhandled Promise Rejection: ${event.reason}`,
          },
          "*"
        );
      };
    };
  }

  getDescription(): string {
    return "Console output capture - logs, errors, and warnings from sandboxed code";
  }

  onExecutionStart(_sandboxId: string, _signal?: AbortSignal): void {
    this.logs = [];
  }

  onExecutionEnd(_sandboxId: string): void {
    // Keep logs for reference
  }

  getLogs(): ConsoleEntry[] {
    return this.logs;
  }

  addLog(entry: ConsoleEntry): void {
    this.logs.push(entry);
  }
}
