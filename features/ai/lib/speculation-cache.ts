/**
 * 预测性预加载缓存
 *
 * 设计理念：类似 CPU 流水线预取（Speculative Execution）
 * - auto 模式下，用户查询实体（工单/项目/用户）时
 * - 后台异步预加载 searchKnowledge 结果
 * - 用户深挖时直接使用缓存，实现秒级响应
 */

import type { RagContext } from "@/features/ai/lib/rag";

interface SpeculationEntry {
  query: string;
  context: RagContext;
  createdAt: number;
  ttl: number; // 过期时间（毫秒）
}

type ConversationCache = Map<string, SpeculationEntry>;

export class SpeculationCache {
  private cache: ConversationCache = new Map();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 分钟过期
  private cleanupCounter = 0;
  private readonly CLEANUP_INTERVAL = 10; // 每 N 次 set 才全量清理

  /**
   * 设置预加载缓存
   */
  set(
    conversationId: string,
    query: string,
    context: RagContext,
    ttl = this.DEFAULT_TTL
  ): void {
    // 惰性清理：每 CLEANUP_INTERVAL 次 set 才全量扫描一次
    if (++this.cleanupCounter >= this.CLEANUP_INTERVAL) {
      this.cleanup();
      this.cleanupCounter = 0;
    }

    const entry: SpeculationEntry = {
      query,
      context,
      createdAt: Date.now(),
      ttl,
    };

    this.cache.set(conversationId, entry);
    console.log(
      `[SpeculationCache] cached conv=${conversationId} query="${query.slice(0, 50)}"`
    );
  }

  /**
   * 获取缓存的 RAG 上下文
   */
  get(conversationId: string, query: string): RagContext | null {
    const entry = this.cache.get(conversationId);

    if (!entry) {
      return null;
    }

    if (!this.isValid(entry)) {
      this.cache.delete(conversationId);
      return null;
    }

    // 检查查询是否匹配（模糊匹配，只要包含关键实体即可）
    const entryEntities = this.extractEntities(entry.query);
    const queryEntities = this.extractEntities(query);

    // 如果提取到的实体有交集，认为匹配
    const hasOverlap = entryEntities.some((e) =>
      queryEntities.some(
        (qe) => e.toLowerCase() === qe.toLowerCase() || e.includes(qe) || qe.includes(e)
      )
    );

    if (hasOverlap || entryEntities.length === 0) {
      console.log(
        `[SpeculationCache] HIT conv=${conversationId} query="${query.slice(0, 50)}"`
      );
      return entry.context;
    }

    return null;
  }

  /**
   * 检查条目是否有效（未过期）
   */
  private isValid(entry: SpeculationEntry): boolean {
    return Date.now() - entry.createdAt < entry.ttl;
  }

  /**
   * 从查询中提取实体（工单号、用户名、项目名等）
   */
  private extractEntities(query: string): string[] {
    const entities: string[] = [];

    // 匹配工单号：工单 #123、工单:123、工单：123
    const ticketMatches = query.match(/工单\s*[#：:]\s*(\d+)/gi);
    if (ticketMatches) {
      entities.push(...ticketMatches);
    }

    // 匹配项目名：项目XXX、项目 的XXX
    const projectMatches = query.match(/项目[的:]?\S+/gi);
    if (projectMatches) {
      entities.push(...projectMatches);
    }

    // 匹配用户名：问 XXX、最近 XXX 在干嘛
    const userMatches = query.match(/(?:问|找|看|查)([^\s]{2,8})/g);
    if (userMatches) {
      entities.push(...userMatches);
    }

    // 匹配"在/为 XXX"模式
    const activityMatches = query.match(/(?:在|为|给)\s*([^\s]{2,10})/g);
    if (activityMatches) {
      entities.push(...activityMatches);
    }

    return entities;
  }

  /**
   * 清理所有过期条目
   */
  cleanup(): void {
    const before = this.cache.size;
    for (const [key, entry] of this.cache.entries()) {
      if (!this.isValid(entry)) {
        this.cache.delete(key);
      }
    }
    const after = this.cache.size;
    if (before !== after) {
      console.log(
        `[SpeculationCache] cleanup removed ${before - after} entries, ${after} remaining`
      );
    }
  }
}

export const speculationCache = new SpeculationCache();

/**
 * 判断消息是否应该触发预加载
 *
 * 触发条件：
 * - 用户问"工单 X" → 很可能需要查看详情/附件
 * - 用户问"项目" → 可能需要了解进展
 * - 用户问"某人最近在干嘛" → 可能需要查看更多讨论
 *
 * 不触发条件：
 * - 用户问"进度/统计" → structured 已够用
 * - search/web 模式 → 直接深挖/联网为主
 */
export function shouldSpeculate(message: string): boolean {
  const patterns = [
    // 工单号：工单 #123、工单:123、工单：123、工单123
    /工单\s*[#：:]\s*\d+/i,
    /工单\s*\d+/i,
    // 项目名：项目XXX、项目 的XXX
    /项目[的:]\S+/i,
    /项目\s+\S+/i,
    // 某人最近在干嘛
    /(?:某人|.+人)在.*(?:干嘛|做什么|忙什么)/i,
    /.+最近在.*(?:干嘛|忙什么|做什么)/i,
    // 问某人：问张三、问 李四
    /(?:问|找|看|查)\s*[^\s]{2,8}/i,
  ];

  return patterns.some((p) => p.test(message));
}
