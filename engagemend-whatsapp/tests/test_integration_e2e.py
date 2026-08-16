"""Teste de integração ponta a ponta: fixture `.txt` → CSV/JSON/manifest.

Verifica diretamente critérios de aceitação do documento original:
- busca por regex de padrão de telefone em todo o diretório de saída
  retorna vazio;
- um export do Android e um do iOS do mesmo grupo produzem `author_hash`
  idênticos para o mesmo membro;
- todo registro exportado valida contra `schema/v1.0.0.json`;
- o mesmo arquivo processado duas vezes produz hashes idênticos.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import jsonschema
import pytest

from src.export import SCHEMA_PATH, build_manifest, build_records, hash_file, write_csv, write_json, write_manifest
from src.normalize import parse_export

FIXTURES = Path(__file__).resolve().parent / "fixtures"

PHONE_PATTERN = re.compile(r"(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b")
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")


def run_pipeline(fixture_name: str, group_name: str, platform: str, output_dir: Path) -> None:
    lines = FIXTURES.joinpath(fixture_name).read_text(encoding="utf-8").splitlines()
    parsed = parse_export(lines)
    assert parsed.platform == platform, f"plataforma detectada ({parsed.platform}) != esperada ({platform})"
    parse_result = parsed.result
    records = build_records(parse_result, group_name, platform)

    write_json(records, output_dir / "output.json")
    write_csv(records, output_dir / "output.csv")

    manifest = build_manifest(parse_result, hash_file(FIXTURES / fixture_name), platform)
    write_manifest(manifest, output_dir / "manifest.json")


class TestEndToEndAndroid:
    def test_full_pipeline_produces_valid_schema_compliant_output(self, tmp_path: Path):
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", tmp_path)

        data = json.loads((tmp_path / "output.json").read_text(encoding="utf-8"))
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema)
        for record in data:
            errors = list(validator.iter_errors(record))
            assert not errors, f"registro inválido: {errors}"

    def test_output_directory_has_no_phone_pattern(self, tmp_path: Path):
        # message_id é um UUID4 (hex + traços) e pode, por coincidência,
        # conter uma subsequência que colide com o padrão de telefone --
        # não é PII, é artefato do formato UUID (mesmo raciocínio de
        # tests/test_schema.py). Removemos os UUIDs antes de varrer.
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", tmp_path)

        for f in tmp_path.iterdir():
            content = f.read_text(encoding="utf-8")
            content_without_uuids = UUID_PATTERN.sub("", content)
            matches = PHONE_PATTERN.findall(content_without_uuids)
            assert not matches, f"padrão de telefone encontrado em {f.name}: {matches}"

    def test_output_directory_has_no_raw_names(self, tmp_path: Path):
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", tmp_path)

        for f in tmp_path.iterdir():
            content = f.read_text(encoding="utf-8")
            assert "João Silva" not in content
            assert "Maria Costa" not in content

    def test_manifest_traces_execution(self, tmp_path: Path):
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", tmp_path)
        manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["lines_processed"] == 20  # mensagens na fixture android
        assert manifest["lines_rejected"] == 0
        assert manifest["detected_platform"] == "android"


class TestSameFileTwiceIsDeterministic:
    def test_reprocessing_same_file_produces_identical_hashes(self, tmp_path: Path):
        out1, out2 = tmp_path / "run1", tmp_path / "run2"
        out1.mkdir()
        out2.mkdir()
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", out1)
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", out2)

        data1 = json.loads((out1 / "output.json").read_text(encoding="utf-8"))
        data2 = json.loads((out2 / "output.json").read_text(encoding="utf-8"))

        ids1 = [r["message_id"] for r in data1]
        ids2 = [r["message_id"] for r in data2]
        hashes1 = [r["author_hash"] for r in data1]
        hashes2 = [r["author_hash"] for r in data2]
        assert ids1 == ids2
        assert hashes1 == hashes2


class TestCrossPlatformAuthorHashMatches:
    def test_same_member_same_hash_across_android_and_ios(self, tmp_path: Path):
        android_dir, ios_dir = tmp_path / "android", tmp_path / "ios"
        android_dir.mkdir()
        ios_dir.mkdir()
        run_pipeline("android_pt_br.txt", "Comunidade Fixture", "android", android_dir)
        run_pipeline("ios_pt_br.txt", "Comunidade Fixture", "ios", ios_dir)

        android_data = json.loads((android_dir / "output.json").read_text(encoding="utf-8"))
        ios_data = json.loads((ios_dir / "output.json").read_text(encoding="utf-8"))

        android_hashes = {r["author_hash"] for r in android_data if r["author_hash"]}
        ios_hashes = {r["author_hash"] for r in ios_data if r["author_hash"]}

        # João Silva e Maria Costa aparecem nas duas fixtures, mesmo grupo:
        # os hashes de autor precisam coincidir (mesma pessoa, dialetos diferentes).
        assert android_hashes & ios_hashes, "nenhum author_hash em comum entre Android e iOS do mesmo grupo"
