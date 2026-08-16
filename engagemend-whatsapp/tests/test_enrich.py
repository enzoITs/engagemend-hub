"""Testes da Fase 3: enriquecimento (char_count, word_count, has_url, has_mention)."""

from __future__ import annotations

from datetime import datetime

import pytest

from src.dialects.base import RawMessage
from src.enrich import enrich_message


@pytest.fixture(autouse=True)
def hmac_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")


def make_message(message_type: str = "text", raw_text: str | None = "oi") -> RawMessage:
    return RawMessage(
        line_number=1,
        line_numbers=[1],
        seq_in_group=1,
        author="João Silva",
        timestamp=datetime(2026, 3, 8, 14, 32),
        message_type=message_type,
        raw_text=raw_text,
    )


class TestTextMessages:
    def test_char_and_word_count(self):
        fields = enrich_message(make_message(raw_text="Bom dia pessoal!"))
        assert fields.char_count == len("Bom dia pessoal!")
        assert fields.word_count == 3

    def test_multiline_text_counts_include_newlines(self):
        fields = enrich_message(make_message(raw_text="linha um\nlinha dois"))
        assert fields.char_count == len("linha um\nlinha dois")
        assert fields.word_count == 4

    def test_has_url_true_for_http(self):
        fields = enrich_message(make_message(raw_text="olha isso https://example.com/x legal"))
        assert fields.has_url is True

    def test_has_url_true_for_www(self):
        fields = enrich_message(make_message(raw_text="olha www.example.com"))
        assert fields.has_url is True

    def test_has_url_false_without_url(self):
        fields = enrich_message(make_message(raw_text="mensagem qualquer sem link"))
        assert fields.has_url is False

    def test_mention_detected_and_hashed(self):
        fields = enrich_message(make_message(raw_text="oi @5511987654321 tudo bem?"))
        assert fields.has_mention is True
        assert len(fields.mentioned_hashes) == 1
        assert len(fields.mentioned_hashes[0]) == 32

    def test_multiple_mentions(self):
        fields = enrich_message(make_message(raw_text="oi @5511987654321 e @5514999999999"))
        assert len(fields.mentioned_hashes) == 2

    def test_no_mention(self):
        fields = enrich_message(make_message(raw_text="mensagem sem menção"))
        assert fields.has_mention is False
        assert fields.mentioned_hashes == []

    def test_mention_hash_correlates_with_author_hash(self):
        from src.anonymize import hash_identifier

        fields = enrich_message(make_message(raw_text="oi @5511987654321"))
        assert fields.mentioned_hashes[0] == hash_identifier("+5511987654321")


class TestNonTextMessages:
    @pytest.mark.parametrize(
        "message_type,raw_text",
        [
            ("system", None),
            ("deleted", "Esta mensagem foi apagada"),
            ("media_image", "<Mídia oculta>"),
            ("media_audio", "áudio ocultado"),
        ],
    )
    def test_non_text_types_always_zeroed(self, message_type: str, raw_text: str | None):
        fields = enrich_message(make_message(message_type=message_type, raw_text=raw_text))
        assert fields.char_count == 0
        assert fields.word_count == 0
        assert fields.has_url is False
        assert fields.has_mention is False
        assert fields.mentioned_hashes == []

    def test_char_count_never_null_even_for_system(self):
        fields = enrich_message(make_message(message_type="system", raw_text=None))
        assert fields.char_count is not None
        assert fields.char_count == 0


class TestEmptyText:
    def test_empty_string_text_message(self):
        fields = enrich_message(make_message(message_type="text", raw_text=""))
        assert fields.char_count == 0
        assert fields.word_count == 0

    def test_none_text_message(self):
        fields = enrich_message(make_message(message_type="text", raw_text=None))
        assert fields.char_count == 0
