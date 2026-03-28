"""Tests for the PDF connector — text extraction and chunking."""

import sys, os
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))


def _create_test_pdf(text_pages: list[str], path: str):
    """Create a test PDF with extractable text using fpdf2."""
    from fpdf import FPDF

    pdf = FPDF()
    for page_text in text_pages:
        pdf.add_page()
        pdf.set_font("Helvetica", size=12)
        pdf.multi_cell(0, 10, page_text)
    pdf.output(path)


class TestPDFConnector:
    def test_extract_text_single_page(self, tmp_path):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        pdf_path = str(tmp_path / "test.pdf")
        _create_test_pdf(["This is a simple test document with some text about motors."], pdf_path)
        connector = PDFConnector()
        text = connector.extract_text(pdf_path)
        assert isinstance(text, str)
        assert len(text) > 0

    def test_chunk_text_short(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        text = "This is a short text that should fit in one chunk."
        chunks = connector.chunk_text(text, "test.pdf", chunk_size=500)
        assert len(chunks) == 1
        assert chunks[0]["content"] == text
        assert chunks[0]["doc_name"] == "test.pdf"
        assert chunks[0]["chunk_index"] == 0

    def test_chunk_text_long(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        words = ["word"] * 1500
        text = " ".join(words)
        chunks = connector.chunk_text(text, "long.pdf", chunk_size=500)
        assert len(chunks) == 3
        for i, chunk in enumerate(chunks):
            assert chunk["chunk_index"] == i
            assert chunk["doc_name"] == "long.pdf"
            assert len(chunk["content"].split()) <= 550

    def test_chunk_text_preserves_word_boundaries(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        words = [f"word{i}" for i in range(600)]
        text = " ".join(words)
        chunks = connector.chunk_text(text, "doc.pdf", chunk_size=500)
        assert len(chunks) == 2
        assert not chunks[0]["content"].endswith(" ")

    def test_process_pdf_returns_chunks(self, tmp_path):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        pdf_path = str(tmp_path / "test.pdf")
        _create_test_pdf(["Some text about motor drivers and electronics."], pdf_path)
        connector = PDFConnector()
        chunks = connector.process_pdf(pdf_path, "test.pdf")
        assert isinstance(chunks, list)
        assert len(chunks) >= 1
        assert "content" in chunks[0]
        assert "doc_name" in chunks[0]
        assert "chunk_index" in chunks[0]

    def test_process_pdf_nonexistent_file(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        chunks = connector.process_pdf("/nonexistent/path.pdf", "missing.pdf")
        assert chunks == []

    def test_chunk_text_empty(self):
        from apps.backend.src.connectors.pdf_connector import PDFConnector
        connector = PDFConnector()
        chunks = connector.chunk_text("", "empty.pdf")
        assert chunks == []
