/**
 * Artifacts Tool - LangChain 工具集成
 * 让 AI Agent 可以创建、更新、删除 Artifacts
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { useArtifactStore } from './artifact-store';

/**
 * Artifacts 工具 Schema
 */
const artifactsSchema = z.object({
  command: z
    .enum(['create', 'update', 'rewrite', 'get', 'delete', 'logs'])
    .describe('Artifact 操作命令'),
  filename: z.string().describe('文件名（必须包含扩展名）'),
  content: z
    .string()
    .optional()
    .describe('文件内容（create/rewrite 必需）'),
  old_str: z
    .string()
    .optional()
    .describe('要替换的旧字符串（update 必需）'),
  new_str: z
    .string()
    .optional()
    .describe('替换后的新字符串（update 必需）'),
});

/**
 * Artifacts 工具实现
 */
export const artifactsTool = tool(
  async ({ command, filename, content, old_str, new_str }) => {
    const store = useArtifactStore.getState();

    try {
      switch (command) {
        case 'create': {
          if (!content) {
            return {
              success: false,
              error: 'content is required for create command',
            };
          }

          await store.createArtifact(filename, content);

          return {
            success: true,
            message: `Created artifact: ${filename}`,
            filename,
          };
        }

        case 'update': {
          if (!old_str || !new_str) {
            return {
              success: false,
              error: 'old_str and new_str are required for update command',
            };
          }

          await store.updateArtifact(filename, old_str, new_str);

          return {
            success: true,
            message: `Updated artifact: ${filename}`,
            filename,
          };
        }

        case 'rewrite': {
          if (!content) {
            return {
              success: false,
              error: 'content is required for rewrite command',
            };
          }

          await store.rewriteArtifact(filename, content);

          return {
            success: true,
            message: `Rewritten artifact: ${filename}`,
            filename,
          };
        }

        case 'get': {
          const artifact = store.getArtifact(filename);

          if (!artifact) {
            return {
              success: false,
              error: `Artifact not found: ${filename}`,
            };
          }

          return {
            success: true,
            artifact: {
              filename: artifact.filename,
              content: artifact.content,
              mimeType: artifact.mimeType,
              createdAt: artifact.createdAt.toISOString(),
              updatedAt: artifact.updatedAt.toISOString(),
            },
          };
        }

        case 'delete': {
          const artifact = store.getArtifact(filename);

          if (!artifact) {
            return {
              success: false,
              error: `Artifact not found: ${filename}`,
            };
          }

          await store.deleteArtifact(filename);

          return {
            success: true,
            message: `Deleted artifact: ${filename}`,
            filename,
          };
        }

        case 'logs': {
          const artifacts = store.listArtifacts();

          return {
            success: true,
            artifacts: artifacts.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              createdAt: a.createdAt.toISOString(),
              updatedAt: a.updatedAt.toISOString(),
              size: a.content.length,
            })),
            count: artifacts.length,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown command: ${command}`,
          };
      }
    } catch (error) {
      console.error('[Artifacts Tool] Error:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  {
    name: 'artifacts',
    description: `Create, update, or manage artifacts (code, documents, images, etc).

Commands:
- create: Create a new artifact with filename and content
- update: Update part of an artifact by replacing old_str with new_str
- rewrite: Completely rewrite an artifact's content
- get: Get an artifact's content and metadata
- delete: Delete an artifact
- logs: List all artifacts

Supported file types:
- Text: .txt, .js, .ts, .py, .java, etc (code files)
- Markdown: .md
- HTML: .html
- SVG: .svg
- Image: .png, .jpg, .gif, .webp
- PDF: .pdf
- Excel: .xlsx, .xls
- Word: .docx

Examples:
- Create HTML: {"command": "create", "filename": "demo.html", "content": "<html>...</html>"}
- Update code: {"command": "update", "filename": "app.js", "old_str": "const x = 1", "new_str": "const x = 2"}
- List all: {"command": "logs", "filename": ""}`,
    schema: artifactsSchema,
  }
);
