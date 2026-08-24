/**
 * Tool Renderers - 模块入口
 * 
 * 注册所有工具渲染器
 */

export { ToolCallRegistry } from './ToolCallRegistry';
export type { ToolCallRendererProps } from './ToolCallRegistry';

// Renderers
export { DefaultRenderer } from './DefaultRenderer';
export { ArtifactsRenderer } from './ArtifactsRenderer';
export { QueryProjectRenderer } from './QueryProjectRenderer';
export { QueryTicketRenderer } from './QueryTicketRenderer';
export { SearchStructuredRenderer } from './SearchStructuredRenderer';
export { QueryCommitsRenderer } from './QueryCommitsRenderer';
export { SubmitReportRenderer } from './SubmitReportRenderer';
export { ThinkingRenderer } from './ThinkingRenderer';

// Auto-register all renderers
import { ToolCallRegistry } from './ToolCallRegistry';
import { DefaultRenderer } from './DefaultRenderer';
import { ArtifactsRenderer } from './ArtifactsRenderer';
import { QueryProjectRenderer } from './QueryProjectRenderer';
import { QueryTicketRenderer } from './QueryTicketRenderer';
import { SearchStructuredRenderer } from './SearchStructuredRenderer';
import { QueryCommitsRenderer } from './QueryCommitsRenderer';
import { SubmitReportRenderer } from './SubmitReportRenderer';
import { ThinkingRenderer } from './ThinkingRenderer';

// Set default renderer
ToolCallRegistry.setDefault(DefaultRenderer);

// Register tool-specific renderers
ToolCallRegistry.register('artifacts', ArtifactsRenderer);
ToolCallRegistry.register('query_project', QueryProjectRenderer);
ToolCallRegistry.register('query_ticket', QueryTicketRenderer);
ToolCallRegistry.register('search_structured', SearchStructuredRenderer);
ToolCallRegistry.register('query_commits', QueryCommitsRenderer);
ToolCallRegistry.register('submit_report', SubmitReportRenderer);
ToolCallRegistry.register('thinking', ThinkingRenderer);

console.log(
  '[ToolCallRegistry] Registered renderers:',
  ToolCallRegistry.getRegisteredTools()
);
