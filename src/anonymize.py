"""HMAC-SHA256 de identificadores e normalização pré-hash.

Requisitos (ver README, seção "Anonimização"):
- A chave (`ANON_HMAC_KEY`) é estável por projeto — nunca gerada por execução.
- Telefones são normalizados para E.164 antes do hash, para que
  `+55 14 99999-9999` e `+5514999999999` produzam o mesmo hash.
- Nomes são normalizados com trim + colapso de espaços + casefold, para que
  variações de capitalização/espaçamento não fragmentem o mesmo autor em
  hashes diferentes.
- A mesma função hasheia telefone, nome de exibição e menções (`@fulano`),
  para que `mentioned_hashes` seja correlacionável com `author_hash`.

⚠️ Suposição de país assumida (documentar, validar com exports reais):
números sem código de país (10 ou 11 dígitos) são tratados como Brasil e
recebem o prefixo `+55` — este projeto atende comunidades brasileiras, mas
um grupo com membros de outros países quebraria essa suposição.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from pathlib import Path

from src.secure_store import write_encrypted_json

_PHONE_LIKE_RE = re.compile(r"^[\d\s()+\-.]+$")
_NON_DIGIT_RE = re.compile(r"\D")


def _normalize_phone_to_e164(raw: str) -> str:
    digits = _NON_DIGIT_RE.sub("", raw)
    if raw.strip().startswith("+"):
        return "+" + digits
    if digits.startswith("55") and len(digits) in (12, 13):
        return "+" + digits
    if len(digits) in (10, 11):
        return "+55" + digits
    # Comprimento fora do esperado para BR: melhor esforço, sem inventar DDI.
    return "+" + digits


def normalize_identifier(raw: str) -> str:
    """Normaliza um identificador (telefone ou nome) antes do hash.

    Telefones (strings compostas só por dígitos e pontuação típica de
    telefone) são convertidos para E.164. Qualquer outra coisa é tratada
    como nome: trim, colapso de espaços internos e casefold.
    """
    stripped = raw.strip()
    if _PHONE_LIKE_RE.match(stripped) and any(ch.isdigit() for ch in stripped):
        return _normalize_phone_to_e164(stripped)
    return " ".join(stripped.split()).casefold()


def hash_identifier(raw: str) -> str:
    """HMAC-SHA256 de um identificador já normalizado, truncado para 32 hex.

    A chave vem de `ANON_HMAC_KEY` (variável de ambiente) — nunca do
    código, nunca do dataset. Levanta `KeyError` se a variável não estiver
    definida (mensagem não expõe `raw`, só o nome da variável ausente).
    """
    key = os.environ["ANON_HMAC_KEY"].encode()
    normalized = normalize_identifier(raw)
    return hmac.new(key, normalized.encode(), hashlib.sha256).hexdigest()[:32]


def build_mapping(raw_identifiers: set[str]) -> dict[str, str]:
    """Constrói o mapeamento identificador bruto → hash, para re-identificação
    controlada (embaixadores precisam ser identificáveis pela organização)."""
    return {raw: hash_identifier(raw) for raw in raw_identifiers}


def write_mapping(raw_identifiers: set[str], path: str | Path) -> None:
    """Grava `mapping.json` cifrado no cofre restrito (`src/secure_store.py`),
    fora do diretório de saída — nunca em texto claro em disco (restrição #1)."""
    write_encrypted_json(build_mapping(raw_identifiers), path)
