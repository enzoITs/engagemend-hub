"""Testes da Fase 5: CLI — leitura de arquivo (encoding), argumentos, execução ponta a ponta."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from src.cli import CliError, main, parse_args, read_export_file, run
from src.secure_store import read_encrypted_json

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(autouse=True)
def keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANON_HMAC_KEY", "chave-de-teste-nao-usar-em-producao")
    monkeypatch.setenv("MAPPING_ENCRYPTION_KEY", Fernet.generate_key().decode())


class TestReadExportFile:
    def test_reads_utf8_file(self, tmp_path: Path):
        f = tmp_path / "export.txt"
        f.write_text("08/03/2026 14:32 - João Silva: café ☕", encoding="utf-8")
        lines = read_export_file(f)
        assert lines == ["08/03/2026 14:32 - João Silva: café ☕"]

    def test_falls_back_to_latin1(self, tmp_path: Path):
        f = tmp_path / "export.txt"
        f.write_bytes("08/03/2026 14:32 - João Silva: café".encode("latin-1"))
        lines = read_export_file(f)
        assert "café" in lines[0]

    def test_file_not_found_raises_cli_error(self, tmp_path: Path):
        with pytest.raises(CliError, match="não encontrado"):
            read_export_file(tmp_path / "nao-existe.txt")

    def test_no_encoding_decodes_raises_cli_error(self, tmp_path: Path):
        f = tmp_path / "export.txt"
        f.write_text("café com açúcar", encoding="utf-8")  # não é ASCII puro
        with pytest.raises(CliError, match="não foi possível decodificar"):
            read_export_file(f, encodings=("ascii",))


class TestParseArgs:
    def test_requires_grupo(self):
        with pytest.raises(SystemExit):
            parse_args(["entrada.txt"])

    def test_defaults(self):
        args = parse_args(["entrada.txt", "--grupo", "Comunidade"])
        assert args.saida == Path("./output")
        assert args.formato == "ambos"
        assert args.log_level == "INFO"

    def test_custom_values(self):
        args = parse_args(
            [
                "entrada.txt",
                "--grupo",
                "Comunidade",
                "--saida",
                "/tmp/out",
                "--formato",
                "csv",
                "--tz",
                "UTC",
                "--log-level",
                "DEBUG",
            ]
        )
        assert args.saida == Path("/tmp/out")
        assert args.formato == "csv"
        assert args.tz == "UTC"
        assert args.log_level == "DEBUG"

    def test_invalid_formato_rejected(self):
        with pytest.raises(SystemExit):
            parse_args(["entrada.txt", "--grupo", "x", "--formato", "xml"])

    def test_mapping_dir_defaults_from_env_var(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MAPPING_STORE_DIR", "/algum/lugar/customizado")
        args = parse_args(["entrada.txt", "--grupo", "Comunidade"])
        assert args.mapping_dir == Path("/algum/lugar/customizado")

    def test_mapping_dir_explicit_flag_overrides_env_var(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("MAPPING_STORE_DIR", "/algum/lugar/customizado")
        args = parse_args(["entrada.txt", "--grupo", "Comunidade", "--mapping-dir", "/outro/lugar"])
        assert args.mapping_dir == Path("/outro/lugar")


class TestRunEndToEnd:
    def test_run_produces_all_artifacts(self, tmp_path: Path):
        input_file = FIXTURES / "android_pt_br.txt"
        output_dir = tmp_path / "output"
        mapping_dir = tmp_path / "secure"

        exit_code = run(
            [
                str(input_file),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(output_dir),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )

        assert exit_code == 0
        assert (output_dir / "output.json").exists()
        assert (output_dir / "output.csv").exists()
        assert (output_dir / "manifest.json").exists()
        assert (output_dir / "unparsed.log").exists()
        assert (mapping_dir / "mapping.json").exists()
        assert (mapping_dir / "author_report.json").exists()

    def test_output_json_has_records(self, tmp_path: Path):
        output_dir = tmp_path / "output"
        run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(output_dir),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ]
        )
        data = json.loads((output_dir / "output.json").read_text(encoding="utf-8"))
        assert len(data) == 20

    def test_only_csv_when_formato_csv(self, tmp_path: Path):
        output_dir = tmp_path / "output"
        run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(output_dir),
                "--mapping-dir",
                str(tmp_path / "secure"),
                "--formato",
                "csv",
            ]
        )
        assert (output_dir / "output.csv").exists()
        assert not (output_dir / "output.json").exists()

    def test_ambiguous_file_returns_error_exit_code(self, tmp_path: Path):
        bad_input = tmp_path / "ruim.txt"
        bad_input.write_text("isso não é um export válido\noutra linha qualquer", encoding="utf-8")
        exit_code = run(
            [str(bad_input), "--grupo", "Comunidade", "--saida", str(tmp_path / "output"), "--mapping-dir", str(tmp_path / "secure")]
        )
        assert exit_code == 1

    def test_missing_input_file_returns_error_exit_code(self, tmp_path: Path):
        exit_code = run(
            [
                str(tmp_path / "nao-existe.txt"),
                "--grupo",
                "Comunidade",
                "--saida",
                str(tmp_path / "output"),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ]
        )
        assert exit_code == 1

    def test_missing_hmac_key_returns_error_exit_code(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("ANON_HMAC_KEY", raising=False)
        exit_code = run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "output"),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ]
        )
        assert exit_code == 1


class TestMain:
    def test_main_exits_with_run_code(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr(
            "sys.argv",
            [
                "whatsapp-pipeline",
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "output"),
                "--mapping-dir",
                str(tmp_path / "secure"),
            ],
        )
        with pytest.raises(SystemExit) as exc_info:
            main()
        assert exc_info.value.code == 0


class TestMappingAccumulatesAcrossRuns:
    def test_second_run_preserves_first_run_identifiers(self, tmp_path: Path):
        mapping_dir = tmp_path / "secure"

        run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "out1"),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )
        mapping_after_first = read_encrypted_json(mapping_dir / "mapping.json")
        assert "João Silva" in mapping_after_first

        run(
            [
                str(FIXTURES / "ios_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "out2"),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )
        mapping_after_second = read_encrypted_json(mapping_dir / "mapping.json")
        # identificadores da primeira execução continuam presentes
        assert "João Silva" in mapping_after_second
        assert "+55 14 99999-9999" in mapping_after_second  # da fixture android
        assert "+55 14 98888-8888" in mapping_after_second  # da fixture ios

    def test_hash_stable_across_runs_for_same_identifier(self, tmp_path: Path):
        mapping_dir = tmp_path / "secure"
        run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "out1"),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )
        hash1 = read_encrypted_json(mapping_dir / "mapping.json")["João Silva"]

        run(
            [
                str(FIXTURES / "ios_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "out2"),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )
        hash2 = read_encrypted_json(mapping_dir / "mapping.json")["João Silva"]
        assert hash1 == hash2

    def test_corrupted_mapping_file_recreated_not_crashed(self, tmp_path: Path):
        mapping_dir = tmp_path / "secure"
        mapping_dir.mkdir(parents=True)
        (mapping_dir / "mapping.json").write_bytes(b"isso nao e um token fernet valido")

        exit_code = run(
            [
                str(FIXTURES / "android_pt_br.txt"),
                "--grupo",
                "Comunidade Fixture",
                "--saida",
                str(tmp_path / "out1"),
                "--mapping-dir",
                str(mapping_dir),
            ]
        )
        assert exit_code == 0
        assert "João Silva" in read_encrypted_json(mapping_dir / "mapping.json")
