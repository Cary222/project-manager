"""RAG 实操：pgvector 写入 + 相似度查询"""
import psycopg2
from sentence_transformers import SentenceTransformer
from pgvector.psycopg2 import register_vector

CONN = "postgresql://community:community@localhost:5432/community"

# 1. 加载 BGE-M3 模型
print("加载模型...")
model = SentenceTransformer("BAAI/bge-m3")

# 2. 准备测试数据
docs = [
    ("ticket", "10001", "登录页面的按钮样式需要调整"),
    ("ticket", "10002", "用户注册后无法收到验证邮件"),
    ("ticket", "10003", "数据库连接池配置需要优化"),
    ("ticket", "10004", "前端搜索框要支持模糊匹配"),
    ("ticket", "10005", "工单已指派给张三处理"),
]

# 3. 编码 + 写入数据库
print("编码并写入 pgvector...")
contents = [d[2] for d in docs]
embeddings = model.encode(contents)

conn = psycopg2.connect(CONN)
register_vector(conn)
cur = conn.cursor()

for (stype, sid, content), emb in zip(docs, embeddings):
    cur.execute(
        "INSERT INTO pm.document_embeddings (source_type, source_id, content, embedding) VALUES (%s, %s, %s, %s)",
        (stype, sid, content, emb.tolist()),
    )
conn.commit()
print(f"写入 {len(docs)} 条完成")

# 4. 语义搜索
query = "搜索功能不好用"
query_emb = model.encode(query)

cur.execute(
    "SELECT content, 1 - (embedding <=> %s::vector) AS similarity FROM pm.document_embeddings ORDER BY embedding <=> %s::vector LIMIT 3",
    (query_emb.tolist(), query_emb.tolist()),
)

print(f"\n搜索: {query}")
for content, sim in cur.fetchall():
    print(f"  {content}  (相似度: {sim:.4f})")

cur.close()
conn.close()
print("\n完成!")
