"""Testes unitários de baixo nível do motor de parsing (src/dialects/base.py):
casos de borda não cobertos pelas fixtures completas (extensões de anexo,
ordem MDY, conversão 12h→24h, truncamento do preview redigido)."""

from __future__ import annotations

from src.detect import DateFormatGuess
from src.dialects.android import AndroidDialectParser
from src.dialects.base import _classify_media_marker, redact_for_log

DMY_24H = DateFormatGuess(order="DMY", separator="/", hour_format="24h", has_seconds=False, order_disambiguated=True)
MDY_12H = DateFormatGuess(order="MDY", separator="/", hour_format="12h", has_seconds=False, order_disambiguated=True)


class TestRedactForLog:
    def test_truncates_long_lines(self):
        long_line = "x" * 200
        redacted = redact_for_log(long_line, max_len=80)
        assert redacted.endswith("…")
        assert len(redacted) == 81

    def test_short_lines_untouched_besides_digit_masking(self):
        assert redact_for_log("linha curta") == "linha curta"


class TestClassifyMediaMarkerAttachmentExtensions:
    def test_video_extension(self):
        assert _classify_media_marker("<anexado: clipe.mp4>") == "media_video"

    def test_audio_extension_alt(self):
        assert _classify_media_marker("<anexado: nota.m4a>") == "media_audio"

    def test_unknown_extension_falls_back_to_document(self):
        assert _classify_media_marker("<anexado: arquivo.xyz123>") == "media_document"

    def test_non_matching_text_returns_none(self):
        assert _classify_media_marker("mensagem de texto normal") is None


class TestClassifySystemWithoutKnownHint:
    def test_generic_no_colon_sentence_classified_as_system(self):
        # sentença de sistema sem ": " e sem casar com nenhuma hint conhecida
        # -- ainda assim deve cair no fallback "sem autor" (armadilha #3),
        # não virar autor fantasma.
        parser = AndroidDialectParser(DMY_24H)
        result = parser.parse(["08/03/2026 09:00 - Este grupo agora usa faturas curtas"])
        assert len(result.messages) == 1
        assert result.messages[0].message_type == "system"
        assert result.messages[0].author is None


class TestParseTimestampOrderAndHourFormat:
    def test_mdy_order(self):
        parser = AndroidDialectParser(MDY_12H)
        ts = parser.parse_timestamp("03/25/2026", "2:32 PM")
        assert (ts.month, ts.day, ts.year) == (3, 25, 2026)

    def test_12h_pm_conversion(self):
        parser = AndroidDialectParser(MDY_12H)
        ts = parser.parse_timestamp("03/25/2026", "2:32 PM")
        assert ts.hour == 14

    def test_12h_am_midnight_conversion(self):
        parser = AndroidDialectParser(MDY_12H)
        ts = parser.parse_timestamp("03/25/2026", "12:05 AM")
        assert ts.hour == 0

    def test_12h_pm_noon_stays_12(self):
        parser = AndroidDialectParser(MDY_12H)
        ts = parser.parse_timestamp("03/25/2026", "12:05 PM")
        assert ts.hour == 12

    def test_two_digit_year_normalized_to_2000s(self):
        parser = AndroidDialectParser(DMY_24H)
        ts = parser.parse_timestamp("08/03/26", "14:32")
        assert ts.year == 2026

    def test_malformed_date_raises_value_error(self):
        parser = AndroidDialectParser(DMY_24H)
        import pytest

        with pytest.raises(ValueError, match="data em formato inesperado"):
            parser.parse_timestamp("2026-03-08-extra", "14:32")

    def test_malformed_time_raises_value_error(self):
        parser = AndroidDialectParser(DMY_24H)
        import pytest

        with pytest.raises(ValueError, match="hora em formato inesperado"):
            parser.parse_timestamp("08/03/2026", "não-é-hora")
