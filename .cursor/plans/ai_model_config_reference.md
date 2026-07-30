# 参考代码：AI 模型配置层

## 1. shadcn-aisdk-model-select 的 React Context 模式

来源：https://github.com/simonorzel26/shadcn-aisdk-model-select

### ModelSelectionContext.tsx（核心模式）

```typescript
'use client';

import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  ReactNode,
  useMemo,
  useState,
} from 'react';

interface ModelSelectionState {
  selectedModelIds: Set<string>;
  isLoaded: boolean;
}

type ModelSelectionAction =
  | { type: 'INITIALIZE'; selectedIds: string[] }
  | { type: 'TOGGLE_MODEL'; modelId: string }
  | { type: 'SELECT_ALL_MODELS' }
  | { type: 'DESELECT_ALL_MODELS' }
  | { type: 'RESET_TO_DEFAULT' };

interface ModelSelectionContextType {
  state: ModelSelectionState;
  selectedModels: AiModel[];
  configurableModels: AiModel[];
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | null>(null);

const SELECTED_MODEL_STORAGE_KEY = 'ai-model-selector:selectedModel';

function modelSelectionReducer(
  state: ModelSelectionState,
  action: ModelSelectionAction,
  configurableModels: AiModel[]
): ModelSelectionState {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        selectedModelIds: new Set(action.selectedIds),
        isLoaded: true,
      };
    case 'TOGGLE_MODEL': {
      const newSet = new Set(state.selectedModelIds);
      if (newSet.has(action.modelId)) {
        newSet.delete(action.modelId);
      } else {
        newSet.add(action.modelId);
      }
      return { ...state, selectedModelIds: newSet };
    }
    // ... 其他 action handler
    default:
      return state;
  }
}

export function ModelSelectionProvider({
  children,
  configurableModels,
  initialModel = '',
}: ModelSelectionProviderProps) {
  const [selectedModel, setSelectedModel] = useState(initialModel);

  // localStorage 持久化，带 hash 防冲突
  const storageKey = useMemo(() => {
    const modelHash = configurableModels.map(m => m.value).sort().join(',');
    return `ai-model-selector-${modelHash}`;
  }, [configurableModels]);

  const [state, dispatch] = useReducer(
    (s: ModelSelectionState, a: ModelSelectionAction) =>
      modelSelectionReducer(s, a, configurableModels),
    { selectedModelIds: new Set(), isLoaded: false }
  );

  // 加载
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const storedModel = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
      
      if (stored) {
        dispatch({ type: 'INITIALIZE', selectedIds: JSON.parse(stored) });
      }
      if (storedModel) {
        setSelectedModel(JSON.parse(storedModel));
      }
    } catch (error) {
      console.error('Failed to load state from localStorage:', error);
    }
  }, [storageKey]);

  // 保存
  useEffect(() => {
    if (state.isLoaded) {
      localStorage.setItem(storageKey, JSON.stringify([...state.selectedModelIds]));
      localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, JSON.stringify(selectedModel));
    }
  }, [state.selectedModelIds, selectedModel, state.isLoaded, storageKey]);

  return (
    <ModelSelectionContext.Provider value={{ state, selectedModel, setSelectedModel }}>
      {children}
    </ModelSelectionContext.Provider>
  );
}

export function useModelSelection(): ModelSelectionContextType {
  const context = useContext(ModelSelectionContext);
  if (!context) throw new Error('useModelSelection must be used within ModelSelectionProvider');
  return context;
}
```

### AiModel 类型定义

```typescript
export type AiModel = {
  value: string;      // 模型标识符
  provider: string;    // 提供商
  model: string;       // 模型名称
  category: 'chat' | 'embedding' | 'transcription' | 'image' | 'completion' | 'speech';
  context_window?: number;
};
```

---

## 2. @nocoo/next-ai 的 ProviderRegistry 工厂模式

来源：https://github.com/nocoo/next-ai

### 核心用法

```typescript
// 1. 安装
npm install @nocoo/next-ai

// 2. 定义 Storage Adapter
import type { AiStorageAdapter, AiTestConfig } from "@nocoo/next-ai";

export const aiAdapter: AiStorageAdapter = {
  async getSettings() {
    return fetch("/api/settings/ai").then(r => r.json());
  },
  async saveSettings(updates) {
    return fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }).then(r => r.json());
  },
  async testConnection(config: AiTestConfig) {
    return fetch("/api/settings/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then(r => r.json());
  },
};

// 3. 注册自定义 Provider
import { AiProviderRegistry } from "@nocoo/next-ai";

const customRegistry = new AiProviderRegistry({
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    sdkType: "openai",
    models: ["deepseek-chat", "deepseek-coder"],
    defaultModel: "deepseek-chat",
  },
});

// 4. 使用
<AiConfigProvider adapter={aiAdapter} registry={customRegistry}>
  <AiSettingsPanel />
</AiConfigProvider>

// 5. Server 端创建模型
import { resolveAiConfig, createAiModel } from "@nocoo/next-ai/server";
import { generateText } from "ai";

export async function POST(req: Request) {
  const settings = await loadUserSettings();
  const config = resolveAiConfig(settings);
  const model = createAiModel(config);
  
  const { text } = await generateText({ model, prompt: "..." });
  return Response.json({ result: text });
}
```

### Hook 用法

```typescript
import { useAiSettings, useAiTest, useProviderRegistry } from "@nocoo/next-ai/react";

// 设置管理
const { settings, loading, saving, save, reload } = useAiSettings();

// 测试连接
const { test, testing, result, error } = useAiTest();

// Provider 注册表访问
const registry = useProviderRegistry();
const providers = registry.getAll();
```

---

## 3. Vercel AI SDK createProviderRegistry

来源：https://github.com/vercel/ai

### 用法

```typescript
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createProviderRegistry } from 'ai';

export const registry = createProviderRegistry({
  // 注册 provider，ID 成为前缀
  anthropic,
  
  // 自定义配置
  openai: createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }),
  
  // 自定义 provider
  deepseek: createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com/v1",
  }),
});

// 访问模型：providerId:modelId 格式
const model = registry.languageModel("anthropic:claude-sonnet-4-20250514");
const model = registry.languageModel("deepseek:deepseek-chat");
```

---

## 4. Settings UI 参考（shadcn/settings-api-keys）

来源：https://www.shadcn.io/blocks/settings-api-keys

### UI 布局参考

```
┌─ AI 模型配置 ─────────────────────────────────────────────────────┐
│                                                                    │
│  默认路由策略（管理员设置）                                         │
│  ├─ 快速对话（chat/quick）→ Agnes 2.5 Flash                    │
│  ├─ 知识检索（search/rag）→ Agnes 2.5 Flash                    │
│  └─ 复杂分析（complex）→ DeepSeek Chat                            │
│                                                                    │
│  可用模型                                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ 🟢 Agnes      │ Agnes 2.5 Flash │ fast │ 已启用 │  [默认▼] │ │
│  │ 🟢 Agnes      │ Agnes 2.0 Flash │ fast │ 已启用 │          │ │
│  │ 🟡 DeepSeek  │ DeepSeek Chat   │ std  │ 未配置 │          │ │
│  │ 🟡 DeepSeek  │ DeepSeek Coder  │ std  │ 未配置 │          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  添加自定义模型                                                    │
│  [Provider ▼]  [模型名称]  [API Key]  [添加]                      │
└────────────────────────────────────────────────────────────────────┘
```

### 关键 UI 元素

1. **状态指示器**：🟢 已配置 / 🟡 未配置
2. **能力标签**：fast / standard / reasoning
3. **启用状态 Badge**
4. **Key 掩码显示**：`sk-****1234` 格式
5. **连接测试反馈**：验证 API Key 是否有效

---

## 5. Key 掩码显示实现

```typescript
// 掩码显示 API Key
function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// 使用
<span className="font-mono text-sm">{maskApiKey(apiKey)}</span>

// 复制按钮
<Button
  variant="ghost"
  size="sm"
  onClick={() => navigator.clipboard.writeText(apiKey)}
>
  <Copy className="h-4 w-4" />
</Button>
```

---

## 6. 命令面板模式（cmdk）

shadcn-aisdk-model-select 使用 cmdk 实现命令面板：

```typescript
import { Command } from "cmdk";

export function ModelSelectCommand({ models, onSelect }) {
  return (
    <Command>
      <CommandInput placeholder="搜索模型..." />
      <CommandList>
        <CommandGroup heading="推荐">
          {recommendedModels.map(m => (
            <CommandItem key={m.value} onSelect={() => onSelect(m.value)}>
              {m.displayName}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="全部">
          {allModels.map(m => (
            <CommandItem key={m.value} onSelect={() => onSelect(m.value)}>
              {m.displayName}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
```

---

## 7. 本项目实施建议

### 简化版 ModelSelectionContext（适配项目）

```typescript
'use client';
import { createContext, useContext, useState, useEffect } from 'react';

interface ModelSelectionContextType {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

const ModelSelectionContext = createContext<ModelSelectionContextType | null>(null);

const STORAGE_KEY = 'pm-preferred-model';

export function ModelSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedModel, setSelectedModel] = useState('agnes-2.5-flash');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSelectedModel(stored);
  }, []);

  const handleSetModel = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem(STORAGE_KEY, model);
  };

  return (
    <ModelSelectionContext.Provider value={{ selectedModel, setSelectedModel: handleSetModel }}>
      {children}
    </ModelSelectionContext.Provider>
  );
}

export function useModelSelection() {
  const context = useContext(ModelSelectionContext);
  if (!context) throw new Error('useModelSelection must be used within ModelSelectionProvider');
  return context;
}
```

### 简化版 createModel（适配项目）

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { buildProxyAwareFetch } from "./proxy";

export function createModel(providerId: string, modelName: string) {
  switch (providerId) {
    case "deepseek":
      return createDeepSeek({
        apiKey: process.env.DEEPSEEK_API_KEY ?? "",
        baseURL: "https://api.deepseek.com/v1",
      })(modelName);
    case "agnes":
    default:
      return createOpenAI({
        baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
        apiKey: process.env.OPENAI_API_KEY ?? "",
        fetch: buildProxyAwareFetch(),
      })(modelName);
  }
}
```
