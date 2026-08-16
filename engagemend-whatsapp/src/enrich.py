"""Derivação dos campos calculados: char_count, word_count, has_url, has_mention.

O texto da mensagem (`RawMessage.raw_text`) é usado apenas em memória aqui e
descartado em seguida — nenhum caminho de código deste módulo escreve o
conteúdo em disco, nem mesmo atrás de flag de debug (restrição #5).

Campos só são calculados para `message_type == "text"`: mensagens de
sistema, mídia e apagadas não têm conteúdo real digitado pelo usuário (o
`raw_text` delas é um marcador do export, não uma mensagem), então contá-las
inflaria artificialmente as métricas usadas para detecção de flood.

⚠️ Suposição sobre o formato de menção (documentar, validar com exports
reais): assumimos que o `.txt` exportado representa uma menção como
`@<telefone-sem-formatação>` (ex.: `@5511987654321`), que é o comportamento
historicamente observado do WhatsApp. Se o export usar `@NomeExibido` em vez
do número, `has_mention`/`mentioned_hashes` ficam subestimados.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.anonymize import hash_identifier
from src.dialects.base import RawMessage

_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_MENTION_RE = re.compile(r"@(\d{8,15})\b")


@dataclass(frozen=True)
class EnrichedFields:
    char_count: int
    word_count: int
    has_url: bool
    has_mention: bool
    mentioned_hashes: list[str]


_EMPTY = EnrichedFields(char_count=0, word_count=0, has_url=False, has_mention=False, mentioned_hashes=[])


def enrich_message(message: RawMessage) -> EnrichedFields:
    if message.message_type != "text" or not message.raw_text:
        return _EMPTY

    text = message.raw_text
    char_count = len(text)
    word_count = len(text.split())
    has_url = bool(_URL_RE.search(text))

    mentions = _MENTION_RE.findall(text)
    mentioned_hashes = [hash_identifier(m) for m in mentions]

    return EnrichedFields(
        char_count=char_count,
        word_count=word_count,
        has_url=has_url,
        has_mention=bool(mentioned_hashes),
        mentioned_hashes=mentioned_hashes,
    )
