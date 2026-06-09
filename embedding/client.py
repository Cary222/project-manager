"""Embedding 客户端 — 本地 pgvector 优先，缺失时调用远端 API"""

import os
import requests
import psycopg2
from pgvector.psycopg2 import register_vector
from typing import Optional

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://community:community@localhost:5432/community"
)
REMOTE_API = os.environ.get("EMBEDDING_API_URL", "http://localhost:5000")
TABLE = "pm.document_embeddings"


def get_db_cursor():
    conn = psycopg2.connect(DATABASE_URL)
    register_vector(conn)
    return conn, conn.cursor()


def search_local(query_text: str, query_emb: list[float], top_k: int = 5) -> list[tuple[str, float]]:
    """查本地 pgvector，按余弦相似度排序"""
    conn, cur = get_db_cursor()
    cur.execute(
        f"""SELECT content, 1 - (embedding <=> %s::vector) AS similarity
            FROM {TABLE}
            ORDER BY embedding <=> %s::vector
            LIMIT %s""",
        (query_emb, query_emb, top_k),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def search(
    query_text: str,
    top_k: int = 5,
    local_fallback: bool = True,
    remote_url: Optional[str] = None,
) -> list[tuple[str, float]]:
    """
    语义搜索：
    1. 先查本地 pgvector 有无记录
    2. 有 → 用本地已有的向量搜索
    3. 无（local_fallback=True）→ 调用远端 API 生成向量，再查
    """
    remote_url = remote_url or REMOTE_API

    conn, cur = get_db_cursor()

    # 检查本地是否有这条文本的向量
    cur.execute(f"SELECT embedding FROM {TABLE} WHERE content = %s LIMIT 1", (query_text,))
    row = cur.fetchone()

    if row is not None:
        # 本地已有，直接用
        query_emb = row[0]
        cur.execute(
            f"""SELECT content, 1 - (embedding <=> %s::vector) AS similarity
                FROM {TABLE}
                ORDER BY embedding <=> %s::vector
                LIMIT %s""",
            (query_emb, query_emb, top_k),
        )
        results = cur.fetchall()
        cur.close()
        conn.close()
        return results

    # 本地缺失，调用远端 API
    if not local_fallback:
        cur.close()
        conn.close()
        raise RuntimeError(f"本地无向量，且 local_fallback=False。请先调用 store_embedding() 存入。")

    print(f"[Embedding] 本地无「{query_text}」，调用远端 API: {remote_url}/embed")
    try:
        resp = requests.post(f"{remote_url}/embed", data={"text": query_text}, timeout=30)
        resp.raise_for_status()
        query_emb = resp.json()["embedding"]
    except Exception as e:
        cur.close()
        conn.close()
        raise RuntimeError(f"远端 API 调用失败: {e}") from e

    cur.execute(
        f"""SELECT content, 1 - (embedding <=> %s::vector) AS similarity
            FROM {TABLE}
            ORDER BY embedding <=> %s::vector
            LIMIT %s""",
        (query_emb, query_emb, top_k),
    )
    results = cur.fetchall()
    cur.close()
    conn.close()
    return results


def store_embedding(text: str, source_type: str, source_id: str, remote_url: Optional[str] = None) -> None:
    """
    将文本存入 pgvector：优先本地编码，本地无模型时调远端 API。
    """
    remote_url = remote_url or REMOTE_API

    # 先尝试本地（如果 sentence_transformers 可用）
    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer("BAAI/bge-m3")
        emb = model.encode(text).tolist()
        source = "local"
    except Exception:
        resp = requests.post(f"{remote_url}/embed", data={"text": text}, timeout=30)
        resp.raise_for_status()
        emb = resp.json()["embedding"]
        source = "remote"

    conn, cur = get_db_cursor()
    cur.execute(
        f"""INSERT INTO {TABLE} (source_type, source_id, content, embedding)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (source_type, source_id) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding""",
        (source_type, source_id, text, emb),
    )
    conn.commit()
    cur.close()
    conn.close()
    print(f"[Embedding] 已存储「{text[:30]}...」（来源: {source}）")


if __name__ == "__main__":
    # 快速测试
    results = search("搜索功能不好用", top_k=3)
    print(f"\n搜索「搜索功能不好用」:")
    for content, sim in results:
        print(f"  {content}  (相似度: {sim:.4f})")
