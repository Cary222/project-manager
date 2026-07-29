"""DOC (OLE 格式) 文本提取器"""
import io
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

# LibreOffice 可执行文件路径
LIBREOFFICE_BIN = (
    os.getenv("LIBREOFFICE_BIN")
    or shutil.which("libreoffice")
    or shutil.which("soffice")
)


def extract_doc(raw: bytes) -> str:
    """将 .doc 文件通过 LibreOffice 转换为 docx，再提取文本"""
    if not os.path.exists(LIBREOFFICE_BIN):
        raise ValueError("libreoffice_not_found")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "input.doc")
        output_path = os.path.join(tmpdir, "output")

        with open(input_path, "wb") as f:
            f.write(raw)

        try:
            result = subprocess.run(
                [
                    LIBREOFFICE_BIN,
                    "--headless",
                    "--convert-to",
                    "docx",
                    "--outdir",
                    tmpdir,
                    input_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                logger.warning("LibreOffice convert failed: %s", result.stderr)
                raise ValueError(f"doc_convert_failed:{result.stderr[:200]}")
        except subprocess.TimeoutExpired:
            raise ValueError("doc_convert_timeout") from None
        except FileNotFoundError:
            raise ValueError("libreoffice_not_found") from None

        converted = os.path.join(tmpdir, "input.docx")
        if not os.path.exists(converted):
            raise ValueError("doc_convert_no_output")

        from .docx import extract_docx_text

        with open(converted, "rb") as f:
            docx_data = f.read()

        return extract_docx_text(docx_data)
