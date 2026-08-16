"""Cofre cifrado para artefatos sensíveis: `mapping.json` e o relatório de
autores. Os dois ficam fora do diretório de saída, cifrados, com o mesmo
controle de acesso — decisão confirmada com o time do produto em resposta
ao conflito entre "relatório de autores lista identificadores brutos para
reconciliação humana" e a restrição #1 ("telefone original nunca é
persistido"). A resolução: persistir, mas cifrado, no mesmo cofre restrito
da chave de re-identificação — nunca em texto claro em disco.

A chave de cifragem (`MAPPING_ENCRYPTION_KEY`) é distinta da chave de hash
(`ANON_HMAC_KEY`, ver `anonymize.py`): uma é reversível (permite
re-identificação controlada), a outra precisa ser irreversível (protege
contra força bruta sobre o hash). Nunca reutilize uma chave para as duas
finalidades.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet


def _get_fernet() -> Fernet:
    key = os.environ["MAPPING_ENCRYPTION_KEY"].encode()
    return Fernet(key)


def write_encrypted_json(data: Any, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    token = _get_fernet().encrypt(payload)
    path.write_bytes(token)


def read_encrypted_json(path: str | Path) -> Any:
    token = Path(path).read_bytes()
    payload = _get_fernet().decrypt(token)
    return json.loads(payload)
