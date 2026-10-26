import hashlib
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain import TaskStatus, require_transition
from app.main import create_app
from app.pointcloud import INPUT_POINTS, validate_xyz


def test_startup_and_contract(tmp_path):
    with TestClient(create_app(Settings(tmp_path, ("http://localhost:5173",)))) as client:
        assert client.get("/api/health").json()["status"] == "ok"
        contract = client.get("/api/capabilities").json()
        assert contract["input"]["point_count"] == 140_000
        assert contract["remote_ready"] is False
        assert client.post("/api/tasks").status_code == 404
    with sqlite3.connect(tmp_path / "app.sqlite3") as db:
        assert db.execute("SELECT count(*) FROM tasks").fetchone() == (0,)


def test_single_administrator(tmp_path):
    with TestClient(create_app(Settings(tmp_path, ()))):
        pass
    with sqlite3.connect(tmp_path / "app.sqlite3") as db:
        query = "INSERT INTO users VALUES (?, ?, 'hash', 'admin', 0, 'now')"
        db.execute(query, ("a", "admin"))
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(query, ("b", "another-admin"))


def test_valid_140k_preserves_file(tmp_path):
    path = tmp_path / "input.xyz"
    content = b"1 2 3 255\n" * INPUT_POINTS
    path.write_bytes(content)
    summary = validate_xyz(path)
    assert summary.point_count == INPUT_POINTS
    assert summary.sha256 == hashlib.sha256(content).hexdigest()
    assert summary.bbox_min == summary.bbox_max == (1, 2, 3)
    assert summary.warnings
    assert path.read_bytes() == content


@pytest.mark.parametrize("content", [b"", b"1 2 3\n", b"nan 1 2\n", b"1 inf 2\n", b"x y z\n", b"1 2\n", b"\n"])
def test_invalid_input(tmp_path, content):
    path = tmp_path / "input.xyz"
    path.write_bytes(content)
    with pytest.raises(ValueError):
        validate_xyz(path)


def test_reference_can_have_different_count(tmp_path):
    path = tmp_path / "reference.xyz"
    path.write_text("0 1 2\n3 4 5\n", encoding="utf-8")
    assert validate_xyz(path, reference=True).point_count == 2


def test_size_limit(tmp_path, monkeypatch):
    monkeypatch.setattr("app.pointcloud.MAX_BYTES", 8)
    path = tmp_path / "input.xyz"
    path.write_bytes(b"0 0 0\n0 0 0\n")
    with pytest.raises(ValueError, match="exceeds"):
        validate_xyz(path, reference=True)


def test_status_flow():
    require_transition(TaskStatus.RUNNING, TaskStatus.DOWNLOADING)
    with pytest.raises(ValueError):
        require_transition(TaskStatus.RUNNING, TaskStatus.SUCCEEDED)
    with pytest.raises(ValueError):
        require_transition(TaskStatus.FAILED, TaskStatus.QUEUED)
