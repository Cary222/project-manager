# 卡码笔记 - 大模型面试题库

来源: https://notes.kamacoder.com/llm/

本目录包含从卡码笔记网站爬取的 AI/LLM 相关技术文档，按类别组织。

## 目录结构

```
docs/interview/
├── README.md              # 本文件
├── agent/                # Agent 相关
├── claude/               # Claude Code 相关
├── deployment/           # 部署与工程化
├── finetuning/           # 模型微调
├── intro/                # 入门认知
├── mcp/                  # MCP 协议
├── misc/                 # 其他
├── prompt/               # Prompt 工程
├── rag/                  # RAG 检索增强
└── transformer/          # Transformer 原理
```

## 文章列表

### Agent (智能体)

| 文件 | 描述 |
|------|------|
| `agent_intro.md` | Agent 到底是什么 |
| `agent_vs_workflow.md` | Agent vs Workflow |
| `agent_tool_design.md` | 工具设计 |
| `agent_memory.md` | 记忆系统设计 |
| `agent_failure_modes.md` | 常见失败模式 |
| `agent_evaluation.md` | 评估方法 |
| `agent_learning_roadmap.md` | 学习路线 |
| `agent_cli.md` | Claude Code Agent |

### Claude Code

| 文件 | 描述 |
|------|------|
| `claude_skills.md` | Claude Skills |
| `claude_code_toolkit_guide.md` | 工具包指南 |
| `claude_code_efficient_guide.md` | 高效使用指南 |
| `claude_code_large_codebase.md` | 大代码库处理 |
| `claude_code_extensions_evolution.md` | 扩展演进 |
| `claude_prompt_cache.md` | Prompt 缓存 |
| `loop_engineering_guide.md` | Loop 工程指南 |
| `managed_agents.md` | 托管 Agent |
| `dynamic_workflows.md` | 动态工作流 |
| `ai_code_migration.md` | AI 编程迁移 |
| `claude_md.md` | Claude MD |
| `claude_code_loop.md` | Claude Code Loop |
| `claude_code_400k_sessions.md` | 40万会话分析 |

### Deployment (部署与工程化)

| 文件 | 描述 |
|------|------|
| `deployment_options.md` | 部署方案选择 |
| `kv_cache_paged_attention.md` | KV Cache 与 Paged Attention |
| `stress_testing.md` | 压测 |

### Finetuning (微调)

| 文件 | 描述 |
|------|------|
| `finetuning_interview.md` | 微调面试题 |
| `finetuning_sft_rlhf_dpo.md` | SFT/RLHF/DPO |
| `finetuning_vs_rag.md` | 微调 vs RAG |
| `lora_qlora.md` | LoRA/QLoRA |

### Intro (入门认知)

| 文件 | 描述 |
|------|------|
| `llm_learning_roadmap.md` | 学习路线 |
| `llm_keywords.md` | 关键词全解 |
| `application_development.md` | 应用开发生态 |
| `app_dev_overview.md` | 应用开发概览 |
| `ai-coding-three-layers.md` | AI 编程三层架构 |
| `how_llm_trained.md` | LLM 训练过程 |
| `gpt56_sol_prompt_guide.md` | GPT-5.6 Sol Prompt |
| `llm_pricing.md` | API 计费 |
| `model_distillation.md` | 模型蒸馏 |
| `why_hello_costs_tokens.md` | Token 计费原理 |
| `fable5_system_prompt_leak.md` | System Prompt 泄露 |

### MCP (协议)

| 文件 | 描述 |
|------|------|
| `mcp_protocol.md` | MCP 协议详解 |

### Prompt (提示工程)

| 文件 | 描述 |
|------|------|
| `prompt_engineering.md` | Prompt 工程基础 |
| `function_calling.md` | Function Calling |
| `prompt_fewshot_cot_reflection.md` | Few-shot/CoT/反思 |
| `structured_output.md` | 结构化输出 |
| `context_engineering.md` | 上下文工程 |
| `streaming_output.md` | 流式输出 |
| `token_cost_latency.md` | Token 与延迟 |
| `model_integration.md` | 模型集成 |

### RAG (检索增强)

| 文件 | 描述 |
|------|------|
| `why_rag.md` | 为什么需要 RAG |
| `rag_evaluation.md` | RAG 评估 |
| `embedding.md` | Embedding 详解 |
| `how_to_chunking.md` | 切片策略 |
| `rag_problems.md` | 常见问题 |
| `rag_interview_framework.md` | 面试框架 |
| `rag_optimization.md` | 优化思路 |
| `vector_database.md` | 向量数据库 |
| `chain_of_rag.md` | Chain of RAG |

### Transformer (原理)

| 文件 | 描述 |
|------|------|
| `transformer_base_1.md` | Transformer 基础 |
| `transformer_base_encoder_decoder.md` | 编码器解码器 |
| `transformer_data_flow.md` | 数据流动 |
| `transformer_structure.md` | 结构 |
| `transformer_block_code.md` | Transformer Block 代码 |
| `tiny_transformer_code.md` | 微型 Transformer |
| `attention_code.md` | Attention 代码 |
| `mha.md` | 多头注意力 |
| `mha_code.md` | MHA 代码 |
| `qkv.md` | QKV |
| `qkv_cal.md` | QKV 计算 |
| `pos_encode.md` | 位置编码 |
| `ffn_ln.md` | FFN 与 LayerNorm |
| `fnn_code.md` | FFN 代码 |
| `layernorm_residual_code.md` | LayerNorm 与残差代码 |

---

*最后更新: 2026-08-14*
