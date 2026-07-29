"""文本提取器集合"""
from .image import extract_image_text
from .docx import extract_docx_text
from .doc import extract_doc
from .wps import extract_wps

__all__ = [
    "extract_image_text",
    "extract_docx_text",
    "extract_doc",
    "extract_wps",
]
