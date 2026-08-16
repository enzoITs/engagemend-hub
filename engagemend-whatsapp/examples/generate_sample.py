"""Gera examples/sample_v1.0.0.json com 50 registros sintéticos válidos.

Uso: python examples/generate_sample.py

Existe apenas para dar ao time do motor de pontuação um arquivo real contra
o qual trabalhar durante a Fase 0, antes que o parser exista. Nenhum dado
aqui vem de um export real — tudo é gerado e hasheado com uma chave de
demonstração fixa, apenas para fins de exemplo de contrato.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.models import WhatsAppMessage  # noqa: E402

DEMO_HMAC_KEY = b"demo-key-nao-usar-em-producao"
PARSER_VERSION = "1.0.0"

MESSAGE_TYPES_WEIGHTED = (
    ["text"] * 30
    + ["media_image"] * 4
    + ["media_video"] * 2
    + ["media_audio"] * 3
    + ["media_sticker"] * 3
    + ["media_document"] * 1
    + ["media_gif"] * 1
    + ["location"] * 1
    + ["contact_card"] * 1
    + ["poll"] * 1
    + ["deleted"] * 2
    + ["system"] * 1
)

DEMO_AUTHORS = [f"Membro Demo {i}" for i in range(1, 9)]
DEMO_GROUP = "Comunidade Demo — Fase 0"


def demo_hash(raw: str) -> str:
    return hmac.new(DEMO_HMAC_KEY, raw.encode(), hashlib.sha256).hexdigest()[:32]


def make_message_id(group_hash: str, seq_in_group: int) -> str:
    seed = f"{group_hash}:{seq_in_group}"
    digest = hashlib.sha256(seed.encode()).digest()
    return str(uuid.UUID(bytes=digest[:16], version=4))


def build_records(n: int = 50, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    group_hash = demo_hash(DEMO_GROUP)
    base_time = datetime(2026, 3, 8, 9, 0, 0, tzinfo=timezone(timedelta(hours=-3)))

    records: list[dict] = []
    for seq in range(1, n + 1):
        message_type = rng.choice(MESSAGE_TYPES_WEIGHTED)
        platform = rng.choice(["android", "ios"])
        timestamp = base_time + timedelta(minutes=rng.randint(0, 3) + seq * 2)

        if message_type == "system":
            author_hash = None
        else:
            author_hash = demo_hash(rng.choice(DEMO_AUTHORS))

        if message_type == "text":
            char_count = rng.randint(1, 280)
            word_count = max(1, char_count // 6)
            has_url = rng.random() < 0.08
        elif message_type in ("system", "deleted"):
            char_count = 0
            word_count = 0
            has_url = False
        else:
            char_count = 0
            word_count = 0
            has_url = False

        has_mention = message_type == "text" and rng.random() < 0.15
        mentioned_hashes = [demo_hash(rng.choice(DEMO_AUTHORS))] if has_mention else []

        record = WhatsAppMessage(
            message_id=make_message_id(group_hash, seq),
            group_hash=group_hash,
            author_hash=author_hash,
            timestamp=timestamp.isoformat(),
            message_type=message_type,
            char_count=char_count,
            word_count=word_count,
            has_mention=has_mention,
            mentioned_hashes=mentioned_hashes,
            has_url=has_url,
            is_edited=message_type == "text" and rng.random() < 0.05,
            source_platform=platform,
            seq_in_group=seq,
            parser_version=PARSER_VERSION,
        )
        records.append(json.loads(record.model_dump_json()))

    return records


def main() -> None:
    records = build_records()
    out_path = Path(__file__).resolve().parent / "sample_v1.0.0.json"
    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Escrito {len(records)} registros em {out_path}")


if __name__ == "__main__":
    main()
