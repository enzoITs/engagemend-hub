"""Testes da Fase 0: schema formal, modelos pydantic e arquivo de exemplo.

Estes testes garantem que os dois artefatos do contrato — `schema/v1.0.0.json`
(JSON Schema) e `src/models.py` (pydantic) — permanecem sincronizados, e que
o arquivo de exemplo entregue ao time do motor de pontuação de fato valida
contra ambos.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from src.models import WhatsAppMessage

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schema" / "v1.0.0.json"
SAMPLE_PATH = ROOT / "examples" / "sample_v1.0.0.json"

# Exige separador (espaço/traço/ponto) entre os dois últimos blocos de 4
# dígitos — isso é sempre verdade em telefones reais ("99999-9999") e nunca
# ocorre por acaso dentro de um hash hex contíguo (sem separadores) ou de um
# timestamp ISO 8601 (separadores em posições incompatíveis).
PHONE_PATTERN = re.compile(r"(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b")
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def _valid_record(**overrides) -> dict:
    base = dict(
        message_id="1e6f3a3a-9b2b-4c9e-8f1a-000000000001",
        group_hash="a" * 32,
        author_hash="b" * 32,
        timestamp="2026-03-08T14:32:45-03:00",
        message_type="text",
        char_count=42,
        word_count=8,
        has_mention=False,
        mentioned_hashes=[],
        has_url=False,
        is_edited=False,
        source_platform="android",
        seq_in_group=1,
        parser_version="1.0.0",
    )
    base.update(overrides)
    return base


def load_schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


class TestJsonSchemaFile:
    def test_schema_file_exists_and_is_valid_json(self):
        assert SCHEMA_PATH.exists()
        load_schema()  # não deve lançar

    def test_schema_itself_is_a_valid_json_schema(self):
        schema = load_schema()
        jsonschema.Draft202012Validator.check_schema(schema)


class TestPydanticModel:
    def test_valid_text_message(self):
        WhatsAppMessage(**_valid_record())

    def test_system_message_requires_null_author_hash(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(message_type="system", author_hash="c" * 32))

    def test_system_message_with_null_author_hash_is_valid(self):
        WhatsAppMessage(**_valid_record(message_type="system", author_hash=None))

    def test_non_system_message_forbids_null_author_hash(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(message_type="text", author_hash=None))

    def test_char_count_is_required(self):
        record = _valid_record()
        del record["char_count"]
        with pytest.raises(ValidationError):
            WhatsAppMessage(**record)

    def test_seq_in_group_is_required(self):
        record = _valid_record()
        del record["seq_in_group"]
        with pytest.raises(ValidationError):
            WhatsAppMessage(**record)

    def test_seq_in_group_minimum_is_one(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(seq_in_group=0))

    def test_group_hash_must_be_hex32(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(group_hash="not-a-hash"))

    def test_mentioned_hashes_must_be_hex32(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(mentioned_hashes=["not-a-hash"]))

    def test_unknown_message_type_rejected(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(message_type="voice_call"))

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            WhatsAppMessage(**_valid_record(unexpected_field="x"))


class TestSampleFile:
    def test_sample_file_exists(self):
        assert SAMPLE_PATH.exists(), (
            "examples/sample_v1.0.0.json não encontrado — rode "
            "`python examples/generate_sample.py`"
        )

    def test_sample_has_exactly_50_records(self):
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        assert len(records) == 50

    def test_every_sample_record_validates_against_pydantic_model(self):
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        for i, record in enumerate(records):
            WhatsAppMessage(**record)

    def test_every_sample_record_validates_against_json_schema(self):
        schema = load_schema()
        validator = jsonschema.Draft202012Validator(schema)
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        for i, record in enumerate(records):
            errors = list(validator.iter_errors(record))
            assert not errors, f"registro {i} (seq_in_group={record.get('seq_in_group')}) inválido: {errors}"

    def test_sample_contains_no_phone_like_patterns(self):
        """Guarda-corrente do critério de aceitação: nenhum telefone em claro na saída.

        `message_id` é um UUID4 (hex + traços) e pode, por coincidência, conter
        uma subsequência que colide com o padrão de telefone — isso não é PII,
        é um artefato do formato UUID. Removemos os UUIDs antes de varrer.
        """
        raw = SAMPLE_PATH.read_text(encoding="utf-8")
        raw_without_uuids = UUID_PATTERN.sub("", raw)
        matches = PHONE_PATTERN.findall(raw_without_uuids)
        assert not matches, f"padrão de telefone encontrado no arquivo de exemplo: {matches}"

    def test_sample_seq_in_group_is_stable_and_sequential(self):
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        seqs = [r["seq_in_group"] for r in records]
        assert seqs == list(range(1, 51))

    def test_sample_char_count_and_seq_in_group_never_null(self):
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        for record in records:
            assert record["char_count"] is not None
            assert record["seq_in_group"] is not None

    def test_sample_system_messages_have_null_author_hash(self):
        records = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
        for record in records:
            if record["message_type"] == "system":
                assert record["author_hash"] is None
            else:
                assert record["author_hash"] is not None
