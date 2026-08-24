/**
 * AI Workspace - 基于 pi-web 重构
 */

import { AiWorkspaceClient } from "./client";

export const metadata = {
  title: 'AI Workspace - ProjectHub',
  description: 'AI 助手工作区'
};

export default function AiWorkspacePage() {
  return <AiWorkspaceClient />;
}
