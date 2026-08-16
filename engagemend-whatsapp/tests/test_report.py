"""Testes da Fase 2: escrita do log de rejeitados (`unparsed.log`)."""

from __future__ import annotations

from pathlib import Path

from src.dialects.base import RejectedLine
from src.report import write_unparsed_log


class TestWriteUnparsedLog:
    def test_writes_line_number_reason_and_redacted_preview(self, tmp_path: Path):
        rejected = [
            RejectedLine(3, "não corresponde a cabeçalho conhecido", "linha ####### rejeitada"),
            RejectedLine(7, "data/hora inválida: mês 13", "32/13/2026 14:32 - x"),
        ]
        out = tmp_path / "unparsed.log"
        write_unparsed_log(rejected, out)

        content = out.read_text(encoding="utf-8")
        assert "linha 3" in content
        assert "não corresponde a cabeçalho conhecido" in content
        assert "linha 7" in content
        assert "data/hora inválida: mês 13" in content

    def test_empty_rejected_list_writes_empty_file(self, tmp_path: Path):
        out = tmp_path / "unparsed.log"
        write_unparsed_log([], out)
        assert out.read_text(encoding="utf-8") == ""

    def test_accepts_path_as_string(self, tmp_path: Path):
        out = tmp_path / "unparsed.log"
        write_unparsed_log([RejectedLine(1, "motivo", "preview")], str(out))
        assert out.exists()
