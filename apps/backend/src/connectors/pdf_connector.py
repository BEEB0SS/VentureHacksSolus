"""
Solus PDF Connector — Extract text from PDFs and chunk for memory storage.

Reads PDF files, extracts text page by page, and splits into ~500 word chunks.
Returns chunks as dicts ready to be fed into MemoryStore.store_document_chunk().
Hackathon: basic text extraction only, no OCR.
"""

from typing import Optional


class PDFConnector:
    """Extract text from PDFs and chunk for memory storage."""

    def extract_text(self, pdf_path: str) -> str:
        """Extract all text from a PDF file. Returns empty string on failure."""
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(pdf_path)
            pages_text = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text.strip())
            return "\n\n".join(pages_text)
        except Exception:
            return ""

    def chunk_text(
        self,
        text: str,
        doc_name: str,
        chunk_size: int = 500,
    ) -> list[dict]:
        """Split text into chunks of approximately `chunk_size` words, preserving word boundaries."""
        if not text or not text.strip():
            return []

        words = text.split()
        chunks = []
        chunk_index = 0
        i = 0

        while i < len(words):
            end = min(i + chunk_size, len(words))
            chunk_words = words[i:end]
            chunk_content = " ".join(chunk_words)
            chunks.append({
                "content": chunk_content,
                "doc_name": doc_name,
                "chunk_index": chunk_index,
            })
            chunk_index += 1
            i = end

        return chunks

    def process_pdf(
        self,
        pdf_path: str,
        doc_name: str,
        chunk_size: int = 500,
    ) -> list[dict]:
        """Extract text from a PDF and return chunks. Returns empty list on failure."""
        text = self.extract_text(pdf_path)
        if not text:
            return []
        return self.chunk_text(text, doc_name, chunk_size)
