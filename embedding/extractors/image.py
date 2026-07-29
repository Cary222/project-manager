"""图片 OCR 文本提取器"""
import io
import logging
from pathlib import Path

from PIL import Image
import pytesseract

logger = logging.getLogger(__name__)

# 显式指定 tesseract 路径，避免服务进程 PATH 不包含 /usr/bin
_TESSERACT_CMD = str(Path("/usr/bin/tesseract").resolve())
pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD


def extract_image_text(raw: bytes, lang: str = "eng+chi_sim") -> str:
    """从图片提取文本（支持 PNG/JPG 等格式）

    Args:
        raw: 图片二进制数据
        lang: tesseract 语言代码，默认为英文+简体中文

    Returns:
        提取的文本内容
    """
    try:
        image = Image.open(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError(f"image_open_error:{exc}") from exc

    try:
        text = pytesseract.image_to_string(image, lang=lang)
    except Exception as exc:
        raise ValueError(f"ocr_error:{exc}") from exc

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)
