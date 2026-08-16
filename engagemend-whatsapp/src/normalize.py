"""Orquestra detecção de plataforma (Fase 1) + parsing de dialeto (Fase 2).

`parse_export` decide automaticamente qual dialeto usar e delega o parsing
completo do arquivo para o parser correspondente. O resultado (`ParseResult`)
já é dialeto-agnóstico — tanto Android quanto iOS produzem os mesmos
`RawMessage`.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.detect import Platform, sniff
from src.dialects.android import AndroidDialectParser
from src.dialects.base import BaseDialectParser, ParseResult
from src.dialects.ios import IOSDialectParser

_SNIFF_SAMPLE_SIZE = 200


@dataclass(frozen=True)
class ParsedExport:
    result: ParseResult
    platform: Platform
    detection_confidence: float


def parse_export(lines: list[str]) -> ParsedExport:
    """Detecta plataforma/locale a partir de uma amostra e parseia o arquivo inteiro.

    Propaga `DetectionError` (de `src.detect.sniff`) sem capturar — se a
    amostra é ambígua demais para detectar com confiança, não há como
    escolher um dialeto sem adivinhar, então a falha deve ser explícita.

    A plataforma detectada é devolvida junto do resultado (não só usada
    internamente para escolher o parser) porque a Fase 4 precisa dela para
    preencher `source_platform` em cada registro exportado.
    """
    sample = lines[:_SNIFF_SAMPLE_SIZE]
    detection = sniff(sample)

    parser: BaseDialectParser
    if detection.platform == "android":
        parser = AndroidDialectParser(detection.date_format)
    else:
        parser = IOSDialectParser(detection.date_format)

    result = parser.parse(lines)
    return ParsedExport(result=result, platform=detection.platform, detection_confidence=detection.confidence)
