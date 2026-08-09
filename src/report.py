"""Log de rejeitados (Fase 2) e relatório de autores (Fase 3).

## Relatório de autores: por que ele é cifrado, não texto claro

O mesmo autor pode aparecer com dois identificadores diferentes no arquivo
(número puro enquanto não estava na agenda, nome salvo depois) — armadilha
#6. Reconciliar isso exige um humano *ver* os identificadores brutos lado a
lado (hashes não permitem reconhecer que "+5514999999999" e "João Silva" são
a mesma pessoa).

Isso está em tensão direta com a restrição #1 ("telefone original nunca é
persistido... não em log"). A resolução, confirmada com o time do produto:
o relatório é persistido, mas cifrado, no mesmo cofre restrito do
`mapping.json` (`src/secure_store.py`) — nunca em texto claro em disco, e
nunca no diretório de saída regular.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from src.anonymize import hash_identifier
from src.dialects.base import RawMessage, RejectedLine
from src.secure_store import write_encrypted_json


def write_unparsed_log(rejected: list[RejectedLine], path: str | Path) -> None:
    """Escreve `unparsed.log`: uma linha por rejeição, com número da linha,
    motivo e um preview já redigido (restrição #4).

    Este módulo não faz nenhuma redação adicional — `RejectedLine.redacted_preview`
    já chega pronto de `dialects.base.redact_for_log`. Nunca grava a linha
    bruta original.
    """
    lines = [
        f"linha {r.line_number}\t{r.reason}\tpreview={r.redacted_preview!r}"
        for r in rejected
    ]
    Path(path).write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


@dataclass(frozen=True)
class AuthorReportEntry:
    raw_identifier: str
    author_hash: str
    message_count: int
    first_seen: str
    last_seen: str


def build_author_report(messages: list[RawMessage]) -> list[AuthorReportEntry]:
    """Agrupa mensagens por identificador bruto de autor (não pelo hash —
    esse é justamente o ponto: dois identificadores do mesmo autor humano
    aparecem como duas entradas distintas aqui, para revisão manual).

    Mensagens de sistema (`author is None`) são ignoradas.
    """
    grouped: dict[str, list[RawMessage]] = defaultdict(list)
    for m in messages:
        if m.author is not None:
            grouped[m.author].append(m)

    entries = [
        AuthorReportEntry(
            raw_identifier=raw_identifier,
            author_hash=hash_identifier(raw_identifier),
            message_count=len(msgs),
            first_seen=min(m.timestamp for m in msgs).isoformat(),
            last_seen=max(m.timestamp for m in msgs).isoformat(),
        )
        for raw_identifier, msgs in grouped.items()
    ]
    return sorted(entries, key=lambda e: -e.message_count)


def write_author_report(entries: list[AuthorReportEntry], path: str | Path) -> None:
    """Grava o relatório de autores cifrado no cofre restrito — nunca em
    texto claro, nunca no diretório de saída (ver docstring do módulo)."""
    write_encrypted_json([asdict(e) for e in entries], path)
