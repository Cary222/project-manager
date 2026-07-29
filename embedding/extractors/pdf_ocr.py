"""PDF 扫描件 OCR 提取器"""
import io
from PIL import Image
import pytesseract
import fitz  # PyMuPDF


def extract_pdf_ocr(raw: bytes, page_from: int | None = None, page_to: int | None = None) -> str:
    """将 PDF 每页渲染为图片后 OCR，逐页判断是否有文字层"""
    texts = []
    doc = fitz.open(stream=raw, filetype="pdf")
    total_pages = len(doc)

    start = max(0, (page_from or 1) - 1) if page_from else 0
    end = min(total_pages, page_to) if page_to else total_pages

    for page_num in range(start, end):
        page = doc[page_num]

        # 先尝试文字提取
        page_text = page.get_text()
        if page_text and page_text.strip():
            texts.append(f"[p{page_num + 1}/{total_pages}] {page_text.strip()}")
            continue

        # 无文字层 → 渲染为图片 → OCR
        pix = page.get_pixmap(dpi=300)
        pil_img = Image.open(io.BytesIO(pix.tobytes("png")))
        ocr_text = pytesseract.image_to_string(pil_img, lang="eng+chi_sim")
        if ocr_text.strip():
            texts.append(f"[p{page_num + 1}/{total_pages}] {ocr_text.strip()}")

    doc.close()
    return "\n".join(texts)
