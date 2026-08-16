"""Testes da Fase 3: relatório de autores (armadilha #6) e mapping.json cifrado."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from src.anonymize import build_mapping, hash_identifier, write_mapping
from src.dialects.base import RawMessage
from src.report import build_author_report, write_author_report
from src.secure_store import read_encrypted_json


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")
    monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())


def make_message(author: str | None, day: int, seq: int) -> RawMessage:
    return RawMessage(
        line_number=seq,
        line_numbers=[seq],
        seq_in_group=seq,
        author=author,
        timestamp=datetime(2026, 3, day, 10, 0),
        message_type="text" if author else "system",
        raw_text="oi" if author else None,
    )


class TestBuildAuthorReport:
    def test_groups_by_raw_identifier_not_by_hash(self):
        # armadilha #6: mesmo autor humano, dois identificadores -> duas entradas.
        messages = [
            make_message("+5514999999999", 8, 1),
            make_message("+5514999999999", 9, 2),
            make_message("João Silva", 10, 3),
        ]
        report = build_author_report(messages)
        identifiers = {e.raw_identifier for e in report}
        assert identifiers == {"+5514999999999", "João Silva"}

    def test_message_count_and_date_range(self):
        messages = [
            make_message("Maria Costa", 8, 1),
            make_message("Maria Costa", 10, 2),
            make_message("Maria Costa", 15, 3),
        ]
        report = build_author_report(messages)
        assert report[0].message_count == 3
        assert report[0].first_seen == "2026-03-08T10:00:00"
        assert report[0].last_seen == "2026-03-15T10:00:00"

    def test_system_messages_excluded(self):
        messages = [make_message(None, 8, 1), make_message("João", 9, 2)]
        report = build_author_report(messages)
        assert len(report) == 1
        assert report[0].raw_identifier == "João"

    def test_sorted_by_message_count_descending(self):
        messages = [
            make_message("Pouco Ativo", 8, 1),
            *[make_message("Muito Ativo", 8, i) for i in range(2, 7)],
        ]
        report = build_author_report(messages)
        assert report[0].raw_identifier == "Muito Ativo"

    def test_author_hash_matches_hash_identifier(self):
        messages = [make_message("+5514999999999", 8, 1)]
        report = build_author_report(messages)
        assert report[0].author_hash == hash_identifier("+5514999999999")


class TestWriteAuthorReportEncrypted:
    def test_written_report_is_encrypted_not_plaintext(self, tmp_path: Path):
        messages = [make_message("+5514999999999", 8, 1)]
        report = build_author_report(messages)
        path = tmp_path / "secure" / "author_report.json"
        write_author_report(report, path)

        raw_bytes = path.read_bytes()
        assert b"5514999999999" not in raw_bytes

        decrypted = read_encrypted_json(path)
        assert decrypted[0]["raw_identifier"] == "+5514999999999"


class TestMapping:
    def test_build_mapping_maps_raw_to_hash(self):
        mapping = build_mapping({"+5514999999999", "João Silva"})
        assert mapping["+5514999999999"] == hash_identifier("+5514999999999")
        assert mapping["João Silva"] == hash_identifier("João Silva")

    def test_write_mapping_is_encrypted_and_roundtrips(self, tmp_path: Path):
        path = tmp_path / "secure" / "mapping.json"
        write_mapping({"+5514999999999"}, path)

        raw_bytes = path.read_bytes()
        assert b"5514999999999" not in raw_bytes

        decrypted = read_encrypted_json(path)
        assert decrypted["+5514999999999"] == hash_identifier("+5514999999999")
