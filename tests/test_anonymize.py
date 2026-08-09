"""Testes da Fase 3: normalização de identificadores e hash HMAC."""

from __future__ import annotations

import pytest

from src.anonymize import hash_identifier, normalize_identifier


@pytest.fixture(autouse=True)
def hmac_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")


class TestNormalizeIdentifierPhones:
    def test_plus_prefixed_with_formatting_strips_to_digits(self):
        assert normalize_identifier("+55 14 99999-9999") == "+5514999999999"

    def test_already_e164_unchanged(self):
        assert normalize_identifier("+5514999999999") == "+5514999999999"

    def test_local_number_without_country_code_gets_br_prefix(self):
        assert normalize_identifier("14999999999") == "+5514999999999"

    def test_number_with_parens_and_dashes(self):
        assert normalize_identifier("(14) 99999-9999") == "+5514999999999"

    def test_formatted_and_plain_produce_same_normalization(self):
        assert normalize_identifier("+55 14 99999-9999") == normalize_identifier("+5514999999999")

    def test_unexpected_length_falls_back_to_plus_prefixed_digits(self):
        # nem 10/11 dígitos (BR sem DDI) nem 12/13 começando com 55 (BR com
        # DDI) -- melhor esforço, sem inventar um DDI que não temos como confirmar.
        assert normalize_identifier("123456") == "+123456"


class TestNormalizeIdentifierNames:
    def test_trims_and_casefolds(self):
        assert normalize_identifier("  João Silva  ") == "joão silva"

    def test_collapses_internal_whitespace(self):
        assert normalize_identifier("João    Silva") == "joão silva"

    def test_case_insensitive(self):
        assert normalize_identifier("JOÃO SILVA") == normalize_identifier("joão silva")

    def test_name_with_colon_not_mistaken_for_phone(self):
        assert normalize_identifier("João: Vendas") == "joão: vendas"


class TestHashIdentifier:
    def test_same_input_same_hash(self):
        assert hash_identifier("João Silva") == hash_identifier("João Silva")

    def test_hash_is_32_hex_chars(self):
        h = hash_identifier("João Silva")
        assert len(h) == 32
        assert all(c in "0123456789abcdef" for c in h)

    def test_phone_formatting_variants_produce_same_hash(self):
        assert hash_identifier("+55 14 99999-9999") == hash_identifier("+5514999999999")

    def test_name_case_variants_produce_same_hash(self):
        assert hash_identifier("João Silva") == hash_identifier("joão silva")

    def test_different_identifiers_produce_different_hashes(self):
        assert hash_identifier("João Silva") != hash_identifier("Maria Costa")

    def test_missing_key_raises_clear_error(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANON_HMAC_KEY", raising=False)
        with pytest.raises(KeyError):
            hash_identifier("João Silva")

    def test_different_key_produces_different_hash(self, monkeypatch: pytest.MonkeyPatch):
        h1 = hash_identifier("João Silva")
        monkeypatch.setenv("ANON_HMAC_KEY", "outra-chave-completamente-diferente")
        h2 = hash_identifier("João Silva")
        assert h1 != h2
