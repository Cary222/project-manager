"""Embedding API 服务 — FastAPI + BGE-M3，监听 0.0.0.0:5000"""
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI(title="Embedding API")

print("加载 BGE-M3 模型（冷启动约 10-30s）...")
model = SentenceTransformer("BAAI/bge-m3")
DIM = model.get_embedding_dimension()
print(f"模型就绪，向量维度: {DIM}")


@app.get("/")
async def root():
    return {"status": "ok", "model": "BAAI/bge-m3", "dimension": DIM}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/dimension")
async def dimension():
    return {"dimension": DIM}


class EmbedRequest(BaseModel):
    text: str


class BatchEmbedRequest(BaseModel):
    texts: list[str]


@app.post("/embed")
async def embed(body: EmbedRequest):
    """接收单个文本，返回 1024 维向量（JSON 数组）"""
    emb = model.encode(body.text).tolist()
    return JSONResponse({"embedding": emb})


@app.post("/embed_batch")
async def embed_batch(body: BatchEmbedRequest):
    """批量编码，避免频繁调用开销"""
    embs = model.encode(body.texts).tolist()
    return JSONResponse({"embeddings": embs})
