"""Testes da Fase 3: cofre cifrado (mapping.json e relatório de autores)."""

from __future__ import annotations

from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from src.secure_store import read_encrypted_json, write_encrypted_json


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())


class TestWriteReadRoundTrip:
    def test_roundtrip_preserves_data(self, tmp_path: Path):
        data = {"+5514999999999": "abc123", "joão silva": "def456"}
        path = tmp_path / "mapping.json"
        write_encrypted_json(data, path)
        assert read_encrypted_json(path) == data

    def test_creates_parent_directories(self, tmp_path: Path):
        path = tmp_path / "secure" / "mapping" / "mapping.json"
        write_encrypted_json({"a": "b"}, path)
        assert path.exists()

    def test_file_on_disk_is_not_plaintext(self, tmp_path: Path):
        path = tmp_path / "mapping.json"
        write_encrypted_json({"+5514999999999": "abc123"}, path)
        raw_bytes = path.read_bytes()
        assert b"5514999999999" not in raw_bytes
        assert b"abc123" not in raw_bytes

    def test_wrong_key_fails_to_decrypt(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        path = tmp_path / "mapping.json"
        write_encrypted_json({"a": "b"}, path)
        monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())
        with pytest.raises(Exception):
            read_encrypted_json(path)
