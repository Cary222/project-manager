/**
 * ToolCallRegistry - 工具渲染器注册表
 * 
 * 管理工具名 → 渲染器组件的映射关系
 */

import type { ComponentType } from 'react';

export interface ToolCallRendererProps {
  toolName: string;
  input: Record<string, any>;
  output: any;
  status: 'pending' | 'success' | 'error';
  error?: string;
}

type RendererComponent = ComponentType<ToolCallRendererProps>;

class ToolCallRegistryImpl {
  private renderers = new Map<string, RendererComponent>();
  private defaultRenderer: RendererComponent | null = null;

  /**
   * 注册工具渲染器
   */
  register(toolName: string, renderer: RendererComponent): void {
    this.renderers.set(toolName, renderer);
  }

  /**
   * 设置默认渲染器（fallback）
   */
  setDefault(renderer: RendererComponent): void {
    this.defaultRenderer = renderer;
  }

  /**
   * 获取工具渲染器
   */
  getRenderer(toolName: string): RendererComponent | null {
    return this.renderers.get(toolName) || this.defaultRenderer;
  }

  /**
   * 检查是否已注册
   */
  has(toolName: string): boolean {
    return this.renderers.has(toolName);
  }

  /**
   * 获取所有已注册的工具名
   */
  getRegisteredTools(): string[] {
    return Array.from(this.renderers.keys());
  }
}

export const ToolCallRegistry = new ToolCallRegistryImpl();
