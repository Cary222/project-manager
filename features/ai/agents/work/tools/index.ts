/**
 * Work Agent Tools
 *
 * Work Agent 专用的受限工具集。
 */

export { createReadResourceTool } from "./read-resource";
export { createWriteFileTool } from "./write-file";
export { createEditFileTool } from "./edit-file";
export { createExecuteCommandTool } from "./execute-command";

import { createReadResourceTool } from "./read-resource";
import { createWriteFileTool } from "./write-file";
import { createEditFileTool } from "./edit-file";
import { createExecuteCommandTool } from "./execute-command";
import { globalToolRegistry } from "@/features/ai/runtime/tool-registry";

/**
 * Register all work tools to the global registry.
 */
export function registerWorkTools(): void {
  globalToolRegistry.register(createReadResourceTool());
  globalToolRegistry.register(createWriteFileTool());
  globalToolRegistry.register(createEditFileTool());
  globalToolRegistry.register(createExecuteCommandTool());
}
