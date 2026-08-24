/**
 * Artifact Store - Zustand 状态管理
 * 
 * 管理所有 artifacts 的增删改查和激活状态
 */

import { create } from 'zustand';
import type { Artifact } from '../ai-workspace/types';

interface ArtifactStore {
  artifacts: Map<string, Artifact>;
  activeFilename: string | null;
  
  // 操作方法（对应 pi-web-ui artifacts tool）
  createArtifact: (filename: string, content: string, mimeType?: string) => Promise<void>;
  updateArtifact: (filename: string, oldStr: string, newStr: string) => Promise<void>;
  rewriteArtifact: (filename: string, content: string) => Promise<void>;
  getArtifact: (filename: string) => Artifact | null;
  deleteArtifact: (filename: string) => Promise<void>;
  listArtifacts: () => Artifact[];
  
  setActive: (filename: string | null) => void;
  clear: () => void;
}

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  const mimeMap: Record<string, string> = {
    'html': 'text/html',
    'svg': 'image/svg+xml',
    'md': 'text/markdown',
    'pdf': 'application/pdf',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls': 'application/vnd.ms-excel',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'txt': 'text/plain',
    'json': 'application/json',
    'csv': 'text/csv',
    'xml': 'application/xml'
  };
  
  return mimeMap[ext || ''] || 'application/octet-stream';
}

export const useArtifactStore = create<ArtifactStore>((set, get) => ({
  artifacts: new Map(),
  activeFilename: null,
  
  createArtifact: async (filename, content, mimeType) => {
    const finalMimeType = mimeType || inferMimeType(filename);
    const now = new Date();
    
    const artifact: Artifact = {
      filename,
      content,
      mimeType: finalMimeType,
      createdAt: now,
      updatedAt: now
    };
    
    set(state => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.set(filename, artifact);
      return {
        artifacts: newArtifacts,
        activeFilename: filename // 自动激活新创建的 artifact
      };
    });
  },
  
  updateArtifact: async (filename, oldStr, newStr) => {
    const artifact = get().artifacts.get(filename);
    if (!artifact) {
      throw new Error(`Artifact "${filename}" not found`);
    }
    
    const newContent = artifact.content.replace(oldStr, newStr);
    if (newContent === artifact.content) {
      throw new Error(`Pattern "${oldStr}" not found in artifact "${filename}"`);
    }
    
    const updatedArtifact: Artifact = {
      ...artifact,
      content: newContent,
      updatedAt: new Date()
    };
    
    set(state => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.set(filename, updatedArtifact);
      return { artifacts: newArtifacts };
    });
  },
  
  rewriteArtifact: async (filename, content) => {
    const artifact = get().artifacts.get(filename);
    if (!artifact) {
      throw new Error(`Artifact "${filename}" not found`);
    }
    
    const updatedArtifact: Artifact = {
      ...artifact,
      content,
      updatedAt: new Date()
    };
    
    set(state => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.set(filename, updatedArtifact);
      return { artifacts: newArtifacts };
    });
  },
  
  getArtifact: (filename) => {
    return get().artifacts.get(filename) || null;
  },
  
  deleteArtifact: async (filename) => {
    set(state => {
      const newArtifacts = new Map(state.artifacts);
      newArtifacts.delete(filename);
      return {
        artifacts: newArtifacts,
        activeFilename: state.activeFilename === filename ? null : state.activeFilename
      };
    });
  },
  
  listArtifacts: () => {
    return Array.from(get().artifacts.values());
  },
  
  setActive: (filename) => {
    set({ activeFilename: filename });
  },
  
  clear: () => {
    set({ artifacts: new Map(), activeFilename: null });
  }
}));
