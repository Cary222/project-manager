"""RAG ③ 实操：用 BGE-M3 把文本变成向量"""
from sentence_transformers import SentenceTransformer
from numpy import dot
from numpy.linalg import norm

def cosine(a, b):
    return dot(a, b) / (norm(a) * norm(b))

print("加载 BGE-M3 模型...")
model = SentenceTransformer("BAAI/bge-m3")

texts = [
    "登录页面的按钮样式需要调整",
    "用户注册后无法收到验证邮件",
    "数据库连接池配置需要优化",
    "前端搜索框要支持模糊匹配",
    "工单 #10001 已指派给张三",
]

print("编码中...")
embeddings = model.encode(texts)

print(f"\n输入了 {len(texts)} 条文本")
print(f"每条文本 -> {len(embeddings[0])} 个浮点数")
print(f"\n「{texts[0]}」")
print(f"  前 5 个值: {embeddings[0][:5]}")

print("\n=== 语义相似度对比 ===")
for i in range(1, len(texts)):
    sim = cosine(embeddings[0], embeddings[i])
    print(f"「登录页按钮样式」 vs 「{texts[i]}」 -> {sim:.4f}")
