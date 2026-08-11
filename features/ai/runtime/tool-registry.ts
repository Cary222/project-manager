/**
 * Tool Registry — 工具注册表
 *
 * 按 Agent 类型分层管理工具。
 * 工具在注册期定义，运行期按 Agent 类型加载。
 */

import { z } from "zod";

// ============================================================================
// Tool Permission Types
// ============================================================================

export type ToolPermission = "read" | "write" | "execute";

// ============================================================================
// Tool Definition Interface
// ============================================================================

export interface ToolDefinition<TDetails = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  permission: ToolPermission;
  agentTypes: string[]; // 允许使用的 Agent 类型，如 ["WORK", "CONVERSATION"]
  execute(ctx: ToolExecutionContext, args: unknown): Promise<ToolExecutionResult<TDetails>>;
}

export interface ToolExecutionContext {
  runId: string;
  userId: string;
  agentType: string;
  workflowType?: string;
  sessionId?: string;
}

export interface ToolExecutionResult<T = unknown> {
  content: string;
  details: T;
  isError?: boolean;
  terminate?: boolean;
}

// ============================================================================
// Tool Registry
// ============================================================================

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Register a tool.
   */
  register<T extends ToolDefinition>(tool: T): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool "${tool.name}" is already registered, skipping.`);
      return;
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools.
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools for a specific agent type.
   */
  getForAgent(agentType: string): ToolDefinition[] {
    return this.list().filter((tool) => tool.agentTypes.includes(agentType));
  }

  /**
   * Get tool names for a specific agent type.
   */
  getNamesForAgent(agentType: string): string[] {
    return this.getForAgent(agentType).map((t) => t.name);
  }

  /**
   * Check if a tool is available for an agent type.
   */
  isAvailableFor(toolName: string, agentType: string): boolean {
    const tool = this.get(toolName);
    if (!tool) return false;
    return tool.agentTypes.includes(agentType);
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

export const globalToolRegistry = new ToolRegistry();

/**
 * Register a tool helper.
 */
export function registerTool<T extends ToolDefinition>(tool: T): void {
  globalToolRegistry.register(tool);
}

/**
 * Get all tools for an agent type.
 */
export function getToolsForAgent(agentType: string): ToolDefinition[] {
  return globalToolRegistry.getForAgent(agentType);
}

/**
 * Get tool names for an agent type.
 */
export function getToolNamesForAgent(agentType: string): string[] {
  return globalToolRegistry.getNamesForAgent(agentType);
}

// ============================================================================
// Tool Execution Helper
// ============================================================================

/**
 * Execute a tool by name with permission check.
 */
export async function executeTool<T = unknown>(
  toolName: string,
  ctx: ToolExecutionContext,
  args: unknown,
): Promise<ToolExecutionResult<T>> {
  const tool = globalToolRegistry.get(toolName);

  if (!tool) {
    return {
      content: `Tool "${toolName}" not found`,
      details: {} as T,
      isError: true,
    };
  }

  if (!tool.agentTypes.includes(ctx.agentType)) {
    return {
      content: `Tool "${toolName}" is not available for agent type "${ctx.agentType}"`,
      details: {} as T,
      isError: true,
    };
  }

  try {
    return await tool.execute(ctx, args) as ToolExecutionResult<T>;
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "Tool execution failed",
      details: {} as T,
      isError: true,
    };
  }
}
