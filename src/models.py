"""Modelos pydantic do contrato de saída v1.0.0.

Este módulo é a fonte de verdade em Python para o schema definido em
`schema/v1.0.0.json`. Qualquer mudança aqui exige a mudança espelhada no
JSON Schema e um bump de versão (`PARSER_VERSION` e nome do arquivo de schema).
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0.0"

_HEX32 = re.compile(r"^[0-9a-f]{32}$")

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

SourcePlatform = Literal["android", "ios"]


class WhatsAppMessage(BaseModel):
    """Registro de saída do pipeline — um por mensagem do export processado."""

    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(
        ..., description="UUID4 gerado deterministicamente a partir de (group_hash + seq_in_group)."
    )
    group_hash: str = Field(..., description="HMAC-SHA256 do nome do grupo, 32 chars.")
    author_hash: str | None = Field(
        ..., description="HMAC-SHA256 do identificador normalizado do autor. Nulo apenas para message_type='system'."
    )
    timestamp: str = Field(..., description="ISO 8601 com timezone.")
    message_type: MessageType
    char_count: int = Field(..., ge=0, description="Campo crítico anti-flood. Nunca nulo.")
    word_count: int = Field(..., ge=0)
    has_mention: bool
    mentioned_hashes: list[str] = Field(default_factory=list)
    has_url: bool
    is_edited: bool
    source_platform: SourcePlatform
    seq_in_group: int = Field(..., ge=1, description="Posição ordinal no arquivo. Campo crítico anti-flood. Nunca nulo.")
    parser_version: str

    @field_validator("group_hash")
    @classmethod
    def _validate_group_hash(cls, v: str) -> str:
        if not _HEX32.match(v):
            raise ValueError("group_hash deve ser hexadecimal de 32 caracteres")
        return v

    @field_validator("author_hash")
    @classmethod
    def _validate_author_hash(cls, v: str | None) -> str | None:
        if v is not None and not _HEX32.match(v):
            raise ValueError("author_hash deve ser hexadecimal de 32 caracteres ou null")
        return v

    @field_validator("mentioned_hashes")
    @classmethod
    def _validate_mentioned_hashes(cls, v: list[str]) -> list[str]:
        for h in v:
            if not _HEX32.match(h):
                raise ValueError("mentioned_hashes deve conter apenas hex de 32 caracteres")
        return v

    @model_validator(mode="after")
    def _validate_author_hash_vs_type(self) -> "WhatsAppMessage":
        if self.message_type == "system" and self.author_hash is not None:
            raise ValueError("mensagens do tipo 'system' devem ter author_hash=null")
        if self.message_type != "system" and self.author_hash is None:
            raise ValueError("apenas mensagens do tipo 'system' podem ter author_hash=null")
        return self
