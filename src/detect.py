"""Detecção de plataforma, locale e formato de data do export.

Recebe as primeiras N linhas do arquivo `.txt` exportado e retorna a
plataforma (Android/iOS), o formato de data (ordem dia/mês, separador,
formato de hora) e um nível de confiança agregado. Roda antes de qualquer
parser de dialeto (Fase 2), que assume a plataforma já decidida.

Princípio de projeto: falhar explicitamente (`DetectionError`) em vez de
adivinhar quando a amostra é ambígua — inclusive quando a ordem dia/mês não
pode ser confirmada pelos próprios dados (nenhuma linha da amostra tem um
componente > 12 que desambiguize DMY de MDY). Assumir DMY por convenção
pt-BR sem evidência seria exatamente o tipo de adivinhação que este módulo
existe para evitar.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Platform = Literal["android", "ios"]
DateOrder = Literal["DMY", "MDY"]
HourFormat = Literal["24h", "12h"]

# Caracteres invisíveis conhecidos em exports do WhatsApp (armadilha #1 do
# README): o iOS insere U+200E (left-to-right mark) antes de timestamps e
# marcadores de mídia. U+200F (RLM) e um BOM residual de UTF-8 também são
# normalizados por precaução. Sem isso os regex abaixo falham silenciosamente.
_INVISIBLE_CHARS = "\u200e\u200f\ufeff"

_DATE = r"(?P<date>\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})"
_TIME = r"(?P<time>\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?)"

# "08/03/2026 14:32 - João Silva: mensagem aqui"
ANDROID_HEADER_RE = re.compile(rf"^{_DATE}\s+{_TIME}\s-\s(?P<rest>.*)$")

# "[08/03/2026, 14:32:45] João Silva: mensagem aqui"
IOS_HEADER_RE = re.compile(rf"^\[{_DATE},\s*{_TIME}\]\s*(?P<rest>.*)$")

# Abaixo deste tanto de linhas reconhecidas, a amostra é estatisticamente
# pequena demais para confiar no resultado, mesmo que a proporção seja 100%.
MIN_ABSOLUTE_MATCHES = 3

CONFIDENCE_THRESHOLD = 0.7


class DetectionError(Exception):
    """Amostra ambígua ou pequena demais para detectar plataforma/locale com confiança."""


@dataclass(frozen=True)
class DateFormatGuess:
    order: DateOrder
    separator: str
    hour_format: HourFormat
    has_seconds: bool
    order_disambiguated: bool


@dataclass(frozen=True)
class DetectionResult:
    platform: Platform
    date_format: DateFormatGuess
    confidence: float
    lines_matched: int
    lines_total: int


def strip_invisible(line: str) -> str:
    return "".join(ch for ch in line if ch not in _INVISIBLE_CHARS)


def _match_lines(lines: list[str]) -> tuple[list[re.Match], list[re.Match]]:
    android_matches: list[re.Match] = []
    ios_matches: list[re.Match] = []
    for raw in lines:
        line = strip_invisible(raw)
        if not line.strip():
            continue
        m = ANDROID_HEADER_RE.match(line)
        if m:
            android_matches.append(m)
            continue
        m = IOS_HEADER_RE.match(line)
        if m:
            ios_matches.append(m)
    return android_matches, ios_matches


def _guess_date_format(matches: list[re.Match]) -> DateFormatGuess:
    separator = "/"
    order: DateOrder = "DMY"
    disambiguated = False
    hour_format: HourFormat = "24h"
    has_seconds = False

    for m in matches:
        date_str = m.group("date")
        time_str = m.group("time")

        sep_match = re.search(r"[/.\-]", date_str)
        if sep_match:
            separator = sep_match.group()

        if not disambiguated:
            parts = re.split(r"[/.\-]", date_str)
            if len(parts) == 3:
                first, second, _year = (int(p) for p in parts)
                if first > 12:
                    order, disambiguated = "DMY", True
                elif second > 12:
                    order, disambiguated = "MDY", True

        if re.search(r"[AaPp]\.?[Mm]\.?", time_str):
            hour_format = "12h"
        if time_str.count(":") == 2:
            has_seconds = True

    return DateFormatGuess(
        order=order,
        separator=separator,
        hour_format=hour_format,
        has_seconds=has_seconds,
        order_disambiguated=disambiguated,
    )


def sniff(lines: list[str]) -> DetectionResult:
    """Detecta plataforma, locale e formato de data a partir de uma amostra de linhas.

    Levanta `DetectionError` (em vez de adivinhar) quando:
    - nenhuma linha corresponde a um cabeçalho Android ou iOS conhecido;
    - poucas linhas foram reconhecidas (amostra estatisticamente pequena);
    - Android e iOS têm contagens de match próximas (arquivo com formatos
      mistos ou amostra não representativa);
    - a ordem dia/mês não pôde ser confirmada por nenhuma data da amostra
      (nenhum componente > 12 observado).
    """
    android_matches, ios_matches = _match_lines(lines)
    total_matched = len(android_matches) + len(ios_matches)

    if total_matched == 0:
        raise DetectionError(
            "Nenhuma linha corresponde a um cabeçalho de mensagem conhecido "
            "(Android ou iOS). Verifique se o arquivo é um export de "
            "WhatsApp válido ou se a amostra fornecida é grande o suficiente."
        )

    if len(android_matches) >= len(ios_matches):
        platform: Platform = "android"
        winning_matches, losing_count = android_matches, len(ios_matches)
    else:
        platform = "ios"
        winning_matches, losing_count = ios_matches, len(android_matches)

    winning_count = len(winning_matches)

    if winning_count < MIN_ABSOLUTE_MATCHES:
        raise DetectionError(
            f"Apenas {winning_count} linha(s) reconhecida(s) como cabeçalho "
            f"'{platform}' na amostra. Mínimo exigido: {MIN_ABSOLUTE_MATCHES}. "
            "Forneça mais linhas antes de detectar."
        )

    platform_confidence = winning_count / (winning_count + losing_count)

    date_format = _guess_date_format(winning_matches)
    date_confidence = 1.0 if date_format.order_disambiguated else 0.5

    confidence = platform_confidence * date_confidence

    if confidence < CONFIDENCE_THRESHOLD:
        losing_platform = "ios" if platform == "android" else "android"
        reasons = []
        if platform_confidence < 1.0:
            reasons.append(
                f"{winning_count} linha(s) casam com '{platform}' e {losing_count} "
                f"com '{losing_platform}' (ambiguidade de plataforma)"
            )
        if not date_format.order_disambiguated:
            reasons.append(
                "nenhuma data da amostra tem componente > 12, então a ordem "
                "dia/mês não pôde ser confirmada (não presumimos DMY por "
                "convenção pt-BR sem evidência)"
            )
        raise DetectionError(
            f"Confiança da detecção ({confidence:.0%}) abaixo do mínimo exigido "
            f"({CONFIDENCE_THRESHOLD:.0%}). Motivo(s): {'; '.join(reasons)}. "
            "Forneça mais linhas ou confirme o locale manualmente."
        )

    return DetectionResult(
        platform=platform,
        date_format=date_format,
        confidence=confidence,
        lines_matched=winning_count,
        lines_total=len(lines),
    )
