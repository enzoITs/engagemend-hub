"""Motor de parsing compartilhado pelos dialetos Android e iOS.

`android.py` e `ios.py` só declaram o regex de cabeçalho — as regras de
negócio (armadilhas do formato) vivem aqui, uma vez só, para os dois
dialetos não divergirem silenciosamente.

Ordem de classificação de cada mensagem (a ordem importa, ver README):
1. Multilinha: linha sem cabeçalho é continuação da mensagem anterior
   (armadilha #2) — decidido antes de qualquer outra regra.
2. Mensagem de sistema: `rest` sem "Autor: texto" — sem autor (armadilha #3).
3. Mensagem apagada: texto bate com um padrão conhecido de "apagada"
   (armadilha #7).
4. Marcador de mídia: texto bate com um marcador mapeado (armadilha #5); se
   parece um marcador (`<...>`) mas é desconhecido, emite warning e usa um
   tipo de mídia genérico em vez de classificar como texto.
5. Caso contrário: texto normal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from src.detect import DateFormatGuess, strip_invisible

Platform = Literal["android", "ios"]

MessageType = Literal[
    "text",
    "media_image",
    "media_video",
    "media_audio",
    "media_sticker",
    "media_document",
    "media_gif",
    "location",
    "contact_card",
    "poll",
    "system",
    "deleted",
]


@dataclass
class RawMessage:
    """Mensagem já delimitada e classificada, ainda não anonimizada/enriquecida.

    `raw_text` existe apenas em memória para as Fases 3 (enriquecimento e
    anonimização) consumirem. Nenhum código deste módulo grava `raw_text`
    em disco.
    """

    line_number: int
    line_numbers: list[int]
    seq_in_group: int
    author: str | None
    timestamp: datetime
    message_type: MessageType
    raw_text: str | None
    is_edited: bool = False


@dataclass
class RejectedLine:
    line_number: int
    reason: str
    redacted_preview: str


@dataclass
class ParseWarning:
    line_number: int
    message: str


@dataclass
class ParseResult:
    messages: list[RawMessage] = field(default_factory=list)
    rejected: list[RejectedLine] = field(default_factory=list)
    warnings: list[ParseWarning] = field(default_factory=list)


_DIGIT_RUN = re.compile(r"\d{4,}")


def redact_for_log(line: str, max_len: int = 80) -> str:
    """Redige uma linha bruta para `unparsed.log`.

    Mascara sequências de 4+ dígitos (potenciais telefones/datas) e trunca o
    comprimento — mesmo uma linha que falhou ao parsear não pode vazar PII
    nem o conteúdo completo de uma mensagem em disco (restrições 1 e 5).
    """
    masked = _DIGIT_RUN.sub(lambda m: "#" * len(m.group()), line)
    if len(masked) > max_len:
        return masked[:max_len] + "…"
    return masked


# Frases de mensagens de sistema conhecidas (armadilha #3). Casamento por
# substring (`in`), não igualdade exata, pois nome de grupo/membro varia.
# Rede de segurança para o caso raro de a sentença conter ": " embutido —
# a detecção primária é a ausência de ": " no `rest` (ver `_classify`).
_SYSTEM_MESSAGE_HINTS = (
    "criou o grupo",
    "entrou usando o link de convite",
    "protegidas com criptografia de ponta a ponta",
    " saiu",
    "mudou o assunto do grupo",
    "mudou a imagem do grupo",
    "adicionou",
    "removeu",
    "agora é admin",
    "deixou de ser admin",
    "mudou o número",
    "alterou as configurações",
)

_DELETED_PATTERNS = (
    "esta mensagem foi apagada",
    "você apagou esta mensagem",
)

# Marcadores de mídia observados em exports reais (armadilha #5). Chave
# normalizada (casefold) → tipo de mensagem.
#
# ⚠️ "<mídia oculta>" é mapeado para media_image por ser o caso mais comum
# observado, mas o marcador genérico não indica o subtipo real de mídia —
# validar contra exports reais.
_MEDIA_MARKERS: dict[str, MessageType] = {
    "<mídia oculta>": "media_image",
    "<midia oculta>": "media_image",
    "imagem ocultada": "media_image",
    "áudio ocultado": "media_audio",
    "audio ocultado": "media_audio",
    "vídeo omitido": "media_video",
    "video omitido": "media_video",
    "figurinha omitida": "media_sticker",
    "documento omitido": "media_document",
    "gif omitido": "media_gif",
}

_IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
_VIDEO_EXT = (".mp4", ".mov", ".3gp")
_AUDIO_EXT = (".opus", ".mp3", ".ogg", ".m4a")
_DOCUMENT_EXT = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt")

_ATTACHED_RE = re.compile(r"^<anexado:\s*(?P<filename>.+)>$", re.IGNORECASE)
_UNKNOWN_MARKER_RE = re.compile(r"^<.+>$")

_AUTHOR_SPLIT_RE = re.compile(r"^(?P<author>.+?): (?P<text>.*)$", re.DOTALL)

_TIME_RE = re.compile(
    r"^(?P<h>\d{1,2}):(?P<m>\d{2})(?::(?P<s>\d{2}))?\s?(?P<ampm>[AaPp]\.?[Mm]\.?)?$"
)


def _classify_media_marker(text: str) -> MessageType | None:
    key = text.strip().casefold()
    if key in _MEDIA_MARKERS:
        return _MEDIA_MARKERS[key]

    attached = _ATTACHED_RE.match(text.strip())
    if attached:
        filename = attached.group("filename")
        ext = f".{filename.rsplit('.', 1)[-1].lower()}" if "." in filename else ""
        if ext in _IMAGE_EXT:
            return "media_image"
        if ext in _VIDEO_EXT:
            return "media_video"
        if ext in _AUDIO_EXT:
            return "media_audio"
        if ext in _DOCUMENT_EXT:
            return "media_document"
        return "media_document"  # anexo com extensão desconhecida: melhor palpite

    return None


class BaseDialectParser:
    """Interface comum dos parsers de dialeto. `platform` e `header_re` são
    definidos pelas subclasses; o resto do motor é compartilhado."""

    platform: Platform
    header_re: re.Pattern[str]

    def __init__(self, date_format: DateFormatGuess) -> None:
        self.date_format = date_format

    def parse_timestamp(self, date_str: str, time_str: str) -> datetime:
        """Converte os grupos `date`/`time` do cabeçalho num datetime local,
        sem timezone — o export não contém timezone; ela é atribuída depois
        (fora do escopo desta fase) a partir de uma configuração do projeto.
        """
        parts = re.split(r"[/.\-]", date_str)
        if len(parts) != 3:
            raise ValueError(f"data em formato inesperado: {date_str!r}")
        first, second, year_str = (int(p) for p in parts)

        if self.date_format.order == "DMY":
            day, month = first, second
        else:
            month, day = first, second

        year = year_str + 2000 if year_str < 100 else year_str

        time_match = _TIME_RE.match(time_str)
        if not time_match:
            raise ValueError(f"hora em formato inesperado: {time_str!r}")

        hour = int(time_match.group("h"))
        minute = int(time_match.group("m"))
        second = int(time_match.group("s") or 0)
        ampm = time_match.group("ampm")
        if ampm:
            ampm_upper = ampm.upper().replace(".", "")
            if ampm_upper == "PM" and hour != 12:
                hour += 12
            elif ampm_upper == "AM" and hour == 12:
                hour = 0

        return datetime(year, month, day, hour, minute, second)

    def parse(self, lines: list[str]) -> ParseResult:
        result = ParseResult()
        current: RawMessage | None = None
        pending: list[tuple[int, str]] = []  # (line_number, texto) de continuação

        def flush() -> None:
            nonlocal current, pending
            if current is None:
                return
            if pending:
                continuation = "\n".join(text for _, text in pending)
                current.raw_text = (
                    f"{current.raw_text}\n{continuation}" if current.raw_text else continuation
                )
                current.line_numbers.extend(ln for ln, _ in pending)
            result.messages.append(current)
            current = None
            pending = []

        for line_number, raw_line in enumerate(lines, start=1):
            line = strip_invisible(raw_line).rstrip("\r\n")

            if not line.strip():
                if current is not None:
                    pending.append((line_number, ""))
                continue  # linha em branco antes da 1ª mensagem: nada a perder

            m = self.header_re.match(line)
            if m:
                flush()
                date_str, time_str, rest = m.group("date"), m.group("time"), m.group("rest")
                try:
                    timestamp = self.parse_timestamp(date_str, time_str)
                except ValueError as exc:
                    result.rejected.append(
                        RejectedLine(line_number, f"data/hora inválida: {exc}", redact_for_log(raw_line))
                    )
                    continue

                message_type, author, text = self._classify(rest, line_number, result.warnings)
                current = RawMessage(
                    line_number=line_number,
                    line_numbers=[line_number],
                    seq_in_group=0,  # atribuído no flush final, na ordem de conclusão
                    author=author,
                    timestamp=timestamp,
                    message_type=message_type,
                    raw_text=text,
                )
                continue

            if current is not None:
                pending.append((line_number, line))
                continue

            result.rejected.append(
                RejectedLine(
                    line_number,
                    "não corresponde a um cabeçalho de mensagem e não há mensagem anterior para continuar",
                    redact_for_log(raw_line),
                )
            )

        flush()

        for seq, msg in enumerate(result.messages, start=1):
            msg.seq_in_group = seq

        return result

    def _classify(
        self, rest: str, line_number: int, warnings: list[ParseWarning]
    ) -> tuple[MessageType, str | None, str | None]:
        rest_cf = rest.strip().casefold()
        if any(hint in rest_cf for hint in _SYSTEM_MESSAGE_HINTS):
            return "system", None, rest.strip() or None

        split = _AUTHOR_SPLIT_RE.match(rest)
        if split is None:
            return "system", None, rest.strip() or None

        author = split.group("author")
        text = split.group("text")

        if rest.count(": ") > 1:
            warnings.append(
                ParseWarning(
                    line_number,
                    "mais de um ': ' na linha — nome de exibição pode conter "
                    "dois-pontos (armadilha #4); autor extraído por heurística "
                    "(primeiro ': '), revisar no relatório de autores",
                )
            )

        if text.strip().casefold() in _DELETED_PATTERNS:
            return "deleted", author, text

        media_type = _classify_media_marker(text)
        if media_type is not None:
            return media_type, author, text

        if _UNKNOWN_MARKER_RE.match(text.strip()):
            warnings.append(
                ParseWarning(
                    line_number,
                    f"marcador de mídia desconhecido: {redact_for_log(text)!r} "
                    "— classificado como media_document por segurança, não como texto",
                )
            )
            return "media_document", author, text

        return "text", author, text
