"""Exportação para CSV, JSON e `manifest.json` (Fase 4).

Monta o `WhatsAppMessage` final (contrato v1.0.0) a partir do `ParseResult`
da Fase 2 e do `enrich_message`/`hash_identifier` da Fase 3, valida contra
o schema formal e grava os três artefatos de uma execução.

## Timezone dos timestamps

O export `.txt` do WhatsApp não contém timezone — é só data/hora local do
aparelho que gerou o export (`RawMessage.timestamp` é "naive", sem tz,
desde a Fase 2). O schema exige ISO 8601 **com** offset. Resolução adotada
aqui: `build_records()` recebe um `tz_name` configurável (IANA, ex.
`"America/Sao_Paulo"`), default `DEFAULT_TIMEZONE`, aplicado a todos os
timestamps do arquivo.

⚠️ Isso assume que **todo o grupo** opera num único fuso — razoável para o
caso de uso declarado (comunidades brasileiras), mas errado se um grupo tiver
membros trocando mensagens em fusos diferentes simultaneamente (o export
não distingue: cada linha tem só a hora local de quem exportou o arquivo,
não do remetente). Não há como corrigir isso sem informação que a fonte não
tem — documentado aqui, não resolvido.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import jsonschema

from src.anonymize import hash_identifier
from src.dialects.base import ParseResult
from src.enrich import enrich_message
from src.models import SCHEMA_VERSION, WhatsAppMessage

DEFAULT_TIMEZONE = "America/Sao_Paulo"
PARSER_VERSION = SCHEMA_VERSION  # hoje idênticas; fisicamente independentes (parser pode evoluir sem quebrar o contrato)

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "v1.0.0.json"

CSV_FIELDNAMES = [
    "message_id",
    "group_hash",
    "author_hash",
    "timestamp",
    "message_type",
    "char_count",
    "word_count",
    "has_mention",
    "mentioned_hashes",
    "has_url",
    "is_edited",
    "source_platform",
    "seq_in_group",
    "parser_version",
]


def make_message_id(group_hash: str, seq_in_group: int) -> str:
    """UUID4 determinístico a partir de (group_hash, seq_in_group) — mesmo
    par sempre produz o mesmo id, sem precisar persistir estado entre execuções."""
    seed = f"{group_hash}:{seq_in_group}"
    digest = hashlib.sha256(seed.encode()).digest()
    return str(uuid.UUID(bytes=digest[:16], version=4))


def build_records(
    parse_result: ParseResult,
    group_name: str,
    source_platform: str,
    tz_name: str = DEFAULT_TIMEZONE,
) -> list[WhatsAppMessage]:
    group_hash = hash_identifier(group_name)
    tz = ZoneInfo(tz_name)

    records: list[WhatsAppMessage] = []
    for msg in parse_result.messages:
        enriched = enrich_message(msg)
        author_hash = hash_identifier(msg.author) if msg.author is not None else None
        localized_ts = msg.timestamp.replace(tzinfo=tz)

        records.append(
            WhatsAppMessage(
                message_id=make_message_id(group_hash, msg.seq_in_group),
                group_hash=group_hash,
                author_hash=author_hash,
                timestamp=localized_ts.isoformat(),
                message_type=msg.message_type,
                char_count=enriched.char_count,
                word_count=enriched.word_count,
                has_mention=enriched.has_mention,
                mentioned_hashes=enriched.mentioned_hashes,
                has_url=enriched.has_url,
                is_edited=msg.is_edited,
                source_platform=source_platform,
                seq_in_group=msg.seq_in_group,
                parser_version=PARSER_VERSION,
            )
        )
    return records


def validate_records_against_schema(records: list[dict], schema_path: str | Path = SCHEMA_PATH) -> None:
    """Validação explícita contra o JSON Schema formal — defesa em profundidade
    além da validação pydantic que já ocorre na construção de `WhatsAppMessage`."""
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)
    for i, record in enumerate(records):
        errors = list(validator.iter_errors(record))
        if errors:
            raise ValueError(
                f"registro {i} (seq_in_group={record.get('seq_in_group')}) "
                f"inválido contra o schema: {[e.message for e in errors]}"
            )


def _record_to_dict(record: WhatsAppMessage) -> dict:
    return json.loads(record.model_dump_json())


def _validated_dicts(records: list[WhatsAppMessage]) -> list[dict]:
    data = [_record_to_dict(r) for r in records]
    validate_records_against_schema(data)
    return data


def _csv_row(record_dict: dict) -> dict:
    row = dict(record_dict)
    row["mentioned_hashes"] = ";".join(row["mentioned_hashes"])
    return row


def records_to_json_string(records: list[WhatsAppMessage]) -> str:
    """Serializa para JSON em memória — usado tanto por `write_json` quanto
    pelo app Streamlit (Fase 6), que nunca deve tocar disco com dado do
    usuário além do que o próprio Streamlit já gerencia internamente."""
    data = _validated_dicts(records)
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def records_to_csv_string(records: list[WhatsAppMessage]) -> str:
    """Serializa para CSV em memória — mesma razão de `records_to_json_string`."""
    data = _validated_dicts(records)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_FIELDNAMES)
    writer.writeheader()
    for row in data:
        writer.writerow(_csv_row(row))
    return buf.getvalue()


def write_json(records: list[WhatsAppMessage], path: str | Path) -> None:
    Path(path).write_text(records_to_json_string(records), encoding="utf-8")


def write_csv(records: list[WhatsAppMessage], path: str | Path) -> None:
    with Path(path).open("w", newline="", encoding="utf-8") as f:
        f.write(records_to_csv_string(records))


@dataclass(frozen=True)
class Manifest:
    parser_version: str
    input_file_sha256: str
    lines_processed: int
    lines_rejected: int
    executed_at: str
    detected_platform: str


def hash_file(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_manifest(
    parse_result: ParseResult,
    input_file_sha256: str,
    detected_platform: str,
    executed_at: datetime | None = None,
) -> Manifest:
    executed_at = executed_at or datetime.now(dt_timezone.utc)
    return Manifest(
        parser_version=PARSER_VERSION,
        input_file_sha256=input_file_sha256,
        lines_processed=len(parse_result.messages),
        lines_rejected=len(parse_result.rejected),
        executed_at=executed_at.isoformat(),
        detected_platform=detected_platform,
    )


def write_manifest(manifest: Manifest, path: str | Path) -> None:
    Path(path).write_text(json.dumps(asdict(manifest), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
