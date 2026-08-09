"""Testes da Fase 1: detecção de plataforma, locale e formato de data."""

from __future__ import annotations

import pytest

from src.detect import DetectionError, sniff, strip_invisible

# Amostras com pelo menos um componente > 12 em alguma data, para que a
# ordem dia/mês seja desambiguada pelos próprios dados (não presumida).

ANDROID_PT_BR = [
    "08/03/2026 14:32 - João Silva: mensagem aqui",
    "13/03/2026 09:05 - +55 14 99999-9999: outra mensagem",
    "14/03/2026 22:10 - Maria Costa: mais uma mensagem",
    "15/03/2026 08:00 - João Silva: e outra",
]

IOS_PT_BR = [
    "[08/03/2026, 14:32:45] João Silva: mensagem aqui",
    "[13/03/2026, 09:05:00] Maria Costa: outra mensagem",
    "[14/03/2026, 22:10:12] João Silva: mais uma",
    "[15/03/2026, 08:00:59] Maria Costa: e outra",
]

# Locale US: MM/DD/YYYY, 12h com AM/PM. "25" no segundo componente confirma
# que o primeiro é mês (não pode ser dia 25 sendo o mês, então é MDY).
ANDROID_US = [
    "03/25/2026 2:32 PM - John Doe: hi there",
    "03/26/2026 9:05 AM - Jane Roe: another message",
    "03/27/2026 10:10 PM - John Doe: yet another",
    "03/28/2026 8:00 AM - Jane Roe: and another",
]


class TestPlatformDetection:
    def test_detects_android_pt_br(self):
        result = sniff(ANDROID_PT_BR)
        assert result.platform == "android"
        assert result.confidence >= 0.7

    def test_detects_ios_pt_br(self):
        result = sniff(IOS_PT_BR)
        assert result.platform == "ios"
        assert result.confidence >= 0.7

    def test_no_matching_lines_raises(self):
        with pytest.raises(DetectionError, match="[Nn]enhuma linha"):
            sniff(["isso não é um export de WhatsApp", "linha qualquer", ""])

    def test_empty_input_raises(self):
        with pytest.raises(DetectionError):
            sniff([])

    def test_too_few_matches_raises(self):
        # apenas 2 linhas reconhecidas, abaixo de MIN_ABSOLUTE_MATCHES
        with pytest.raises(DetectionError, match="[Mm]ínimo exigido"):
            sniff(ANDROID_PT_BR[:2])

    def test_mixed_platform_file_raises(self):
        mixed = ANDROID_PT_BR[:3] + IOS_PT_BR[:3]
        with pytest.raises(DetectionError, match="[Cc]onfiança"):
            sniff(mixed)

    def test_clear_platform_dominance_with_few_noise_lines_still_detects(self):
        # 8 linhas android reais + 1 linha iOS isolada não deve derrubar a
        # confiança abaixo do limiar (dominância clara).
        lines = ANDROID_PT_BR * 2 + IOS_PT_BR[:1]
        result = sniff(lines)
        assert result.platform == "android"


class TestDateFormatDetection:
    def test_pt_br_order_is_dmy_when_disambiguated(self):
        result = sniff(ANDROID_PT_BR)
        assert result.date_format.order == "DMY"
        assert result.date_format.order_disambiguated is True

    def test_pt_br_separator_is_slash(self):
        result = sniff(ANDROID_PT_BR)
        assert result.date_format.separator == "/"

    def test_android_pt_br_is_24h_without_seconds(self):
        result = sniff(ANDROID_PT_BR)
        assert result.date_format.hour_format == "24h"
        assert result.date_format.has_seconds is False

    def test_ios_pt_br_has_seconds(self):
        result = sniff(IOS_PT_BR)
        assert result.date_format.has_seconds is True

    def test_us_locale_is_mdy_and_12h(self):
        result = sniff(ANDROID_US)
        assert result.date_format.order == "MDY"
        assert result.date_format.hour_format == "12h"

    def test_ambiguous_date_order_raises_instead_of_assuming_dmy(self):
        # todas as datas têm dia e mês <= 12: impossível desambiguar order
        # sem adivinhar. O módulo deve falhar, não presumir DMY por convenção.
        ambiguous = [
            "01/02/2026 10:00 - João Silva: msg",
            "02/03/2026 11:00 - Maria Costa: msg",
            "03/04/2026 12:00 - João Silva: msg",
            "04/05/2026 13:00 - Maria Costa: msg",
        ]
        with pytest.raises(DetectionError, match="ordem dia/mês"):
            sniff(ambiguous)


class TestMultilineAndNoise:
    def test_continuation_lines_are_ignored_not_counted_as_dialect(self):
        lines = [
            ANDROID_PT_BR[0],
            "essa é uma segunda linha da mesma mensagem, sem cabeçalho",
            "e uma terceira linha ainda",
            ANDROID_PT_BR[1],
            ANDROID_PT_BR[2],
            ANDROID_PT_BR[3],
        ]
        result = sniff(lines)
        assert result.platform == "android"
        assert result.lines_matched == 4
        assert result.lines_total == len(lines)

    def test_blank_lines_are_ignored(self):
        lines = ["", "  ", *ANDROID_PT_BR, ""]
        result = sniff(lines)
        assert result.platform == "android"


class TestInvisibleCharacters:
    def test_strip_invisible_removes_lrm_rlm_bom(self):
        dirty = "‎[08/03/2026, 14:32:45]‏ João Silva: oi﻿"
        clean = strip_invisible(dirty)
        assert "‎" not in clean
        assert "‏" not in clean
        assert "﻿" not in clean

    def test_ios_detection_survives_lrm_prefix(self):
        dirty_ios = [f"‎{line}" for line in IOS_PT_BR]
        result = sniff(dirty_ios)
        assert result.platform == "ios"
