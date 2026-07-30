/**
 * 用户自定义 Provider 不在此文件定义——
 * 用户的 provider 配置存储在数据库中（api_key_store + 动态发现的模型列表）。
 * 这里只导出类型，供其他模块使用。
 */
import type { ModelCatalogEntry } from "./types";

export type { ModelCatalogEntry };
