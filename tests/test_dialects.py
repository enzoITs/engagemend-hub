"""Testes da Fase 2: parsers de dialeto Android/iOS via `normalize.parse_export`.

Meta de aceitação: sobre as fixtures, ≥99% das linhas classificadas e zero
perda silenciosa (toda linha contribui para uma mensagem, é rejeitada com
motivo registrado, ou é uma linha em branco legítima).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.detect import DateFormatGuess, DetectionError
from src.dialects.android import AndroidDialectParser
from src.dialects.base import ParseResult
from src.normalize import parse_export

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def load_lines(name: str) -> list[str]:
    return FIXTURES.joinpath(name).read_text(encoding="utf-8").splitlines()


def assert_no_silent_loss(lines: list[str], result: ParseResult) -> None:
    """Toda linha do arquivo original é contabilizada em algum lugar."""
    accounted: set[int] = set()
    for msg in result.messages:
        accounted.update(msg.line_numbers)
    for rej in result.rejected:
        accounted.add(rej.line_number)

    for line_number, line in enumerate(lines, start=1):
        if line_number in accounted:
            continue
        assert not line.strip(), (
            f"linha {line_number} ({line!r}) não foi contabilizada em mensagem "
            "nem em rejeitados, e não é uma linha em branco — perda silenciosa"
        )


class TestAndroidFixture:
    @pytest.fixture
    def lines(self) -> list[str]:
        return load_lines("android_pt_br.txt")

    @pytest.fixture
    def result(self, lines: list[str]) -> ParseResult:
        return parse_export(lines).result

    def test_no_rejected_lines(self, result: ParseResult) -> None:
        assert result.rejected == []

    def test_no_silent_loss(self, lines: list[str], result: ParseResult) -> None:
        assert_no_silent_loss(lines, result)

    def test_at_least_99_percent_classified(self, lines: list[str], result: ParseResult) -> None:
        non_blank = sum(1 for line in lines if line.strip())
        classified = sum(len(m.line_numbers) for m in result.messages)
        assert classified / non_blank >= 0.99

    def test_system_messages_have_no_author(self, result: ParseResult) -> None:
        system_msgs = [m for m in result.messages if m.message_type == "system"]
        assert len(system_msgs) == 5  # criptografia, criou, entrou, mudou assunto, saiu
        for m in system_msgs:
            assert m.author is None

    def test_deleted_messages_classified_with_author(self, result: ParseResult) -> None:
        deleted = [m for m in result.messages if m.message_type == "deleted"]
        assert len(deleted) == 2
        for m in deleted:
            assert m.author is not None

    def test_media_markers_classified_by_type(self, result: ParseResult) -> None:
        by_text = {m.raw_text: m.message_type for m in result.messages}
        assert by_text["<Mídia oculta>"] == "media_image"
        assert by_text["figurinha omitida"] == "media_sticker"
        assert by_text["áudio ocultado"] == "media_audio"
        assert by_text["vídeo omitido"] == "media_video"
        assert by_text["documento omitido"] == "media_document"
        assert by_text["<anexado: IMG-20260314-WA0007.jpg>"] == "media_image"
        assert by_text["<anexado: relatorio-vendas.pdf>"] == "media_document"
        assert by_text["<anexado: nota-de-voz.opus>"] == "media_audio"

    def test_unknown_media_marker_not_classified_as_text(self, result: ParseResult) -> None:
        unknown = next(m for m in result.messages if m.raw_text == "<marcador-desconhecido-xyz>")
        assert unknown.message_type == "media_document"
        assert any("marcador de mídia desconhecido" in w.message for w in result.warnings)

    def test_phone_number_author_preserved_raw_for_downstream_hashing(self, result: ParseResult) -> None:
        # Fase 2 não anonimiza — isso é trabalho da Fase 3. Só confirma que
        # o identificador bruto chega íntegro ao próximo estágio.
        phone_msgs = [m for m in result.messages if m.author == "+55 14 99999-9999"]
        assert len(phone_msgs) == 2

    def test_display_name_with_colon_triggers_warning(self, result: ParseResult) -> None:
        # armadilha #4: "João: Vendas" quebra split(":") ingênuo. Não temos
        # como desambiguar com certeza, então o comportamento esperado é:
        # heurística de melhor esforço + warning explícito, não perda.
        assert any("dois-pontos" in w.message for w in result.warnings)
        ambiguous = next(
            m for m in result.messages if m.raw_text and m.raw_text.startswith("Vendas:")
        )
        assert ambiguous.author == "João"
        assert "Alguém viu a proposta" in ambiguous.raw_text

    def test_multiline_continuation_merged_into_previous_message(self, result: ParseResult) -> None:
        ambiguous = next(
            m for m in result.messages if m.raw_text and m.raw_text.startswith("Vendas:")
        )
        assert "Ainda não tive retorno" in ambiguous.raw_text
        assert "Obrigado desde já" in ambiguous.raw_text

    def test_seq_in_group_is_sequential_from_one(self, result: ParseResult) -> None:
        seqs = [m.seq_in_group for m in result.messages]
        assert seqs == list(range(1, len(result.messages) + 1))


class TestIOSFixture:
    @pytest.fixture
    def lines(self) -> list[str]:
        return load_lines("ios_pt_br.txt")

    @pytest.fixture
    def result(self, lines: list[str]) -> ParseResult:
        return parse_export(lines).result

    def test_no_rejected_lines(self, result: ParseResult) -> None:
        assert result.rejected == []

    def test_no_silent_loss(self, lines: list[str], result: ParseResult) -> None:
        assert_no_silent_loss(lines, result)

    def test_at_least_99_percent_classified(self, lines: list[str], result: ParseResult) -> None:
        non_blank = sum(1 for line in lines if line.strip())
        classified = sum(len(m.line_numbers) for m in result.messages)
        assert classified / non_blank >= 0.99

    def test_survives_lrm_prefix_on_system_and_media_lines(self, result: ParseResult) -> None:
        # armadilha #1: U+200E antes do timestamp e antes de marcador de mídia.
        system_msgs = [m for m in result.messages if m.message_type == "system"]
        assert len(system_msgs) == 5
        media_image = next(m for m in result.messages if m.raw_text == "<Mídia oculta>")
        assert media_image.message_type == "media_image"
        audio = next(m for m in result.messages if m.raw_text == "áudio ocultado")
        assert audio.message_type == "media_audio"

    def test_has_seconds_and_matches_android_authors(self, result: ParseResult) -> None:
        deleted = [m for m in result.messages if m.message_type == "deleted"]
        assert len(deleted) == 2
        assert deleted[0].timestamp.second != 0 or deleted[1].timestamp.second != 0


class TestRejectedLinesNeverSilentlyDropped:
    def test_garbage_line_before_first_message_is_rejected_not_lost(self) -> None:
        lines = [
            "##### ARQUIVO CORROMPIDO NO INÍCIO, TELEFONE +55 14 91234-5678 #####",
            *load_lines("android_pt_br.txt"),
        ]
        result = parse_export(lines).result
        assert len(result.rejected) == 1
        assert result.rejected[0].line_number == 1
        # o preview redigido nunca deve conter a sequência de dígitos crua
        assert "91234" not in result.rejected[0].redacted_preview
        assert "5678" not in result.rejected[0].redacted_preview

    def test_invalid_date_is_rejected_with_clear_reason_not_silently_wrong(self) -> None:
        parser = AndroidDialectParser(
            DateFormatGuess(order="DMY", separator="/", hour_format="24h", has_seconds=False, order_disambiguated=True)
        )
        lines = ["32/13/2026 14:32 - João Silva: data impossível"]
        result = parser.parse(lines)
        assert result.messages == []
        assert len(result.rejected) == 1
        assert "data/hora inválida" in result.rejected[0].reason


class TestDetectionPropagation:
    def test_ambiguous_sample_raises_before_choosing_a_dialect(self) -> None:
        # não deve escolher um dialeto "no chute" quando a amostra é ambígua.
        with pytest.raises(DetectionError):
            parse_export(["não é um export válido", "outra linha qualquer"])

    def test_platform_and_confidence_exposed_to_caller(self) -> None:
        parsed = parse_export(load_lines("android_pt_br.txt"))
        assert parsed.platform == "android"
        assert 0.0 < parsed.detection_confidence <= 1.0
