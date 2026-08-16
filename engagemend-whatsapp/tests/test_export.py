"""Testes da Fase 4: montagem de registros, CSV/JSON validados, manifest.json."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from pathlib import Path

import jsonschema
import pytest

from src.anonymize import hash_identifier
from src.dialects.base import ParseResult, RawMessage
from src.export import (
    SCHEMA_PATH,
    build_manifest,
    build_records,
    hash_file,
    make_message_id,
    records_to_csv_string,
    records_to_json_string,
    validate_records_against_schema,
    write_csv,
    write_json,
    write_manifest,
)


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")


def make_raw_message(
    seq: int,
    author: str | None = "João Silva",
    message_type: str = "text",
    raw_text: str | None = "Bom dia pessoal!",
) -> RawMessage:
    return RawMessage(
        line_number=seq,
        line_numbers=[seq],
        seq_in_group=seq,
        author=author,
        timestamp=datetime(2026, 3, 8, 14, 32, 0),
        message_type=message_type,
        raw_text=raw_text,
    )


def sample_parse_result() -> ParseResult:
    return ParseResult(
        messages=[
            make_raw_message(1, author="João Silva", raw_text="Bom dia!"),
            make_raw_message(2, author="+55 14 99999-9999", raw_text="oi @5511987654321"),
            make_raw_message(3, author=None, message_type="system", raw_text=None),
            make_raw_message(4, author="Maria Costa", message_type="deleted", raw_text="Esta mensagem foi apagada"),
        ],
        rejected=[],
        warnings=[],
    )


class TestMakeMessageId:
    def test_deterministic(self):
        assert make_message_id("a" * 32, 1) == make_message_id("a" * 32, 1)

    def test_different_seq_different_id(self):
        assert make_message_id("a" * 32, 1) != make_message_id("a" * 32, 2)

    def test_different_group_different_id(self):
        assert make_message_id("a" * 32, 1) != make_message_id("b" * 32, 1)

    def test_looks_like_valid_uuid4(self):
        import uuid

        msg_id = make_message_id("a" * 32, 1)
        parsed = uuid.UUID(msg_id)
        assert parsed.version == 4


class TestBuildRecords:
    def test_produces_one_record_per_message(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert len(records) == 4

    def test_group_hash_identical_across_records(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert len({r.group_hash for r in records}) == 1
        assert records[0].group_hash == hash_identifier("Comunidade Teste")

    def test_system_message_has_null_author_hash(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        system_record = next(r for r in records if r.message_type == "system")
        assert system_record.author_hash is None

    def test_non_system_has_author_hash(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert records[0].author_hash == hash_identifier("João Silva")

    def test_same_person_different_identifier_still_correlatable_via_report_not_hash(self):
        # author_hash de "+55 14 99999-9999" e de "João Silva" são
        # DIFERENTES por design -- a correlação é feita no relatório de
        # autores (Fase 3), não aqui.
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert records[0].author_hash != records[1].author_hash

    def test_timestamp_has_timezone_offset(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert records[0].timestamp.endswith("-03:00")

    def test_custom_timezone(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android", tz_name="UTC")
        assert records[0].timestamp.endswith("+00:00")

    def test_mention_hash_correlates_with_future_author_hash(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        mention_record = records[1]
        assert mention_record.mentioned_hashes == [hash_identifier("+5511987654321")]

    def test_seq_in_group_preserved(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert [r.seq_in_group for r in records] == [1, 2, 3, 4]

    def test_deterministic_across_runs_same_hashes(self):
        r1 = build_records(sample_parse_result(), "Comunidade Teste", "android")
        r2 = build_records(sample_parse_result(), "Comunidade Teste", "android")
        assert [r.message_id for r in r1] == [r.message_id for r in r2]
        assert [r.author_hash for r in r1] == [r.author_hash for r in r2]
        assert [r.group_hash for r in r1] == [r.group_hash for r in r2]


class TestValidateRecordsAgainstSchema:
    def test_valid_records_pass(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        data = [json.loads(r.model_dump_json()) for r in records]
        validate_records_against_schema(data)  # não deve lançar

    def test_invalid_record_raises(self):
        bad_record = {
            "message_id": "not-a-uuid",
            "group_hash": "too-short",
            "author_hash": None,
            "timestamp": "not-a-date",
            "message_type": "invalid_type",
            "char_count": -1,
            "word_count": 0,
            "has_mention": False,
            "mentioned_hashes": [],
            "has_url": False,
            "is_edited": False,
            "source_platform": "android",
            "seq_in_group": 1,
            "parser_version": "1.0.0",
        }
        with pytest.raises(ValueError, match="inválido contra o schema"):
            validate_records_against_schema([bad_record])


class TestWriteJsonAndCsv:
    def test_write_json_roundtrips_and_validates(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        path = tmp_path / "out.json"
        write_json(records, path)

        data = json.loads(path.read_text(encoding="utf-8"))
        assert len(data) == 4

        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema)
        for record in data:
            assert not list(validator.iter_errors(record))

    def test_write_csv_has_header_and_rows(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        path = tmp_path / "out.csv"
        write_csv(records, path)

        with path.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 4
        assert rows[0]["message_type"] == "text"

    def test_csv_mentioned_hashes_semicolon_joined(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        path = tmp_path / "out.csv"
        write_csv(records, path)

        with path.open(encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        mention_row = rows[1]
        assert mention_row["mentioned_hashes"] == hash_identifier("+5511987654321")

    def test_csv_never_contains_raw_phone_or_name(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        path = tmp_path / "out.csv"
        write_csv(records, path)
        content = path.read_text(encoding="utf-8")
        assert "João Silva" not in content
        assert "99999-9999" not in content
        assert "5511987654321" not in content  # só o hash da menção deve estar presente

    def test_json_never_contains_raw_phone_or_name(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        path = tmp_path / "out.json"
        write_json(records, path)
        content = path.read_text(encoding="utf-8")
        assert "João Silva" not in content
        assert "99999-9999" not in content


class TestInMemoryBuilders:
    """records_to_json_string / records_to_csv_string (Fase 6): mesmo
    conteúdo que write_json/write_csv produzem em disco, mas em memória —
    usados pelo app Streamlit, que não pode tocar disco com dado do usuário."""

    def test_json_string_matches_file_content(self, tmp_path: Path):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        write_json(records, tmp_path / "out.json")
        assert records_to_json_string(records) == (tmp_path / "out.json").read_text(encoding="utf-8")

    def test_csv_string_matches_file_content(self, tmp_path: Path):
        # newline="" ao ler de volta: write_csv preserva o \r\n que o módulo
        # csv usa por padrão; read_text() sem isso normalizaria para \n e
        # criaria uma diferença espúria que não reflete um bug real.
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        write_csv(records, tmp_path / "out.csv")
        with (tmp_path / "out.csv").open(newline="", encoding="utf-8") as f:
            assert records_to_csv_string(records) == f.read()

    def test_json_string_validates_against_schema(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        data = json.loads(records_to_json_string(records))
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema)
        for record in data:
            assert not list(validator.iter_errors(record))

    def test_csv_string_parses_back_to_same_row_count(self):
        records = build_records(sample_parse_result(), "Comunidade Teste", "android")
        rows = list(csv.DictReader(io.StringIO(records_to_csv_string(records))))
        assert len(rows) == len(records)


class TestManifest:
    def test_hash_file_matches_sha256(self, tmp_path: Path):
        import hashlib

        f = tmp_path / "export.txt"
        f.write_bytes(b"conteudo qualquer")
        assert hash_file(f) == hashlib.sha256(b"conteudo qualquer").hexdigest()

    def test_build_manifest_counts_processed_and_rejected(self):
        from src.dialects.base import RejectedLine

        parse_result = sample_parse_result()
        parse_result.rejected.append(RejectedLine(10, "motivo", "preview"))

        manifest = build_manifest(parse_result, "abc123", "android")
        assert manifest.lines_processed == 4
        assert manifest.lines_rejected == 1
        assert manifest.detected_platform == "android"
        assert manifest.input_file_sha256 == "abc123"

    def test_write_manifest_produces_valid_json(self, tmp_path: Path):
        manifest = build_manifest(sample_parse_result(), "abc123", "ios")
        path = tmp_path / "manifest.json"
        write_manifest(manifest, path)

        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["input_file_sha256"] == "abc123"
        assert data["detected_platform"] == "ios"
        assert "executed_at" in data
        assert "parser_version" in data
