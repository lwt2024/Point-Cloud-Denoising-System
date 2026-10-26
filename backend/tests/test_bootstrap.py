from dotenv import dotenv_values

from app import bootstrap


def test_bootstrap_preserves_environment_and_does_not_print_token(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(bootstrap, "ROOT", tmp_path)
    path = tmp_path / ".env"
    path.write_text("PCDS_STORAGE_DIR=./storage\nPCDS_ADMIN_TOKEN=\n", encoding="utf-8")
    bootstrap.main()
    values = dotenv_values(path)
    assert values["PCDS_STORAGE_DIR"] == "./storage"
    assert len(values["PCDS_ADMIN_TOKEN"]) >= 32
    assert values["PCDS_ADMIN_TOKEN"] not in capsys.readouterr().out
    previous = path.read_bytes()
    bootstrap.main()
    assert path.read_bytes() == previous


def test_bootstrap_creates_new_local_configuration(tmp_path, monkeypatch):
    monkeypatch.setattr(bootstrap, "ROOT", tmp_path)
    bootstrap.main()
    assert len(dotenv_values(tmp_path / ".env")["PCDS_ADMIN_TOKEN"]) >= 32
