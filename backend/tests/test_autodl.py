import io
import json
import shlex
import stat
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import paramiko
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.autodl import (
    AutoDLConnector,
    PinnedHostKey,
    RemoteConfig,
    RemoteError,
    RemoteStore,
    fingerprint,
    run_python_probe,
)
from app.config import Settings
from app.main import create_app

TOKEN = "test-admin-token-" + "a" * 32
HEADERS = {"Authorization": "Bearer " + TOKEN}


def config(**changes):
    return RemoteConfig(
        **{
            "host": "example.invalid",
            "private_key_path": "keyfile",
            "work_dir": "/jobs",
            "algorithm_entry": "/project/entry.py",
            "pcn_checkpoint": "/models/pcn.pth",
            "pdlts_checkpoint": "/models/pdlts.ckpt",
            "algorithm_version": "a1",
            "model_version": "m1",
            "config_version": "c1",
            **changes,
        }
    )


def settings(tmp_path):
    return Settings(tmp_path, ("http://localhost:5173",), TOKEN)


@pytest.mark.parametrize(
    "changes",
    [
        {"host": "ssh root@example.com -p 22"},
        {"port": 0},
        {"port": 65536},
        {"username": "root; ls"},
        {"work_dir": "/"},
        {"algorithm_entry": "relative.py"},
        {"work_dir": "/jobs/../other"},
        {"host_fingerprint": "SHA256:wrong"},
        {"python_path": "python --help"},
        {"private_key_path": "secret\npath"},
    ],
)
def test_config_rejects_ambiguous_values(changes):
    with pytest.raises(ValidationError):
        config(**changes)


def test_host_key_is_never_automatically_trusted():
    key = MagicMock()
    key.asbytes.return_value = b"server public key"
    pin = fingerprint(key)
    with pytest.raises(RemoteError, match="尚未受信任") as failure:
        PinnedHostKey("").missing_host_key(None, "host", key)
    assert failure.value.fingerprint == pin
    PinnedHostKey(pin).missing_host_key(None, "host", key)
    with pytest.raises(RemoteError, match="不符"):
        PinnedHostKey("SHA256:" + "A" * 43).missing_host_key(None, "host", key)


def test_all_admin_routes_require_token(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        for method, path in [
            ("GET", "/api/admin/autodl"),
            ("PUT", "/api/admin/autodl"),
            ("POST", "/api/admin/autodl/test"),
        ]:
            assert client.request(method, path).status_code == 401
        assert (
            client.get("/api/admin/autodl", headers={"Authorization": "Bearer bad"}).status_code
            == 401
        )
        assert (
            client.get(
                "/api/admin/autodl", headers={**HEADERS, "Origin": "https://evil.invalid"}
            ).status_code
            == 403
        )
        assert client.get("/api/admin/autodl", headers=HEADERS).status_code == 200


def test_missing_admin_configuration_is_closed(tmp_path):
    with TestClient(create_app(Settings(tmp_path, ()))) as client:
        assert client.get("/api/admin/autodl", headers=HEADERS).status_code == 503
        assert client.get("/api/capabilities").json()["remote_ready"] is False


def test_api_config_persistence_invalidation_and_safe_status(tmp_path):
    app = create_app(settings(tmp_path))
    connector = MagicMock()
    connector.check.return_value = {
        "success": True,
        "code": "ready",
        "message": "ok",
        "checks": [],
        "duration_ms": 1,
    }
    app.state.remote.connector = connector
    with TestClient(app) as client:
        saved = client.put("/api/admin/autodl", headers=HEADERS, json=config().model_dump())
        assert saved.json()["status"] == "untested"
        tested = client.post("/api/admin/autodl/test", headers=HEADERS)
        assert tested.json()["status"] == "ready"
        public = client.get("/api/capabilities").json()
        assert public["remote_ready"] is True
        assert public["features"]["denoising"] is False
        assert "example.invalid" not in json.dumps(public)
        assert "keyfile" not in json.dumps(public)
        client.put("/api/admin/autodl", headers=HEADERS, json=config(port=2222).model_dump())
        assert client.get("/api/capabilities").json()["remote_ready"] is False
    with TestClient(create_app(settings(tmp_path))) as restarted:
        assert restarted.get("/api/admin/autodl", headers=HEADERS).json()["config"]["port"] == 2222


def test_status_expiry_and_serialized_tests(tmp_path):
    store = RemoteStore(settings(tmp_path), MagicMock())
    store.save(config())
    store.connector.check.return_value = {"success": True}
    store.test()
    assert store.status() == "ready"
    record = store.report()
    record["checked_epoch"] = time.time() - 301
    store.report_path.write_text(json.dumps(record), encoding="utf-8")
    assert store.status() == "stale"
    store.lock.acquire()
    try:
        with pytest.raises(RemoteError, match="正在进行"):
            store.test()
        with pytest.raises(RemoteError, match="进行中"):
            store.save(config())
    finally:
        store.lock.release()


class ProbeFile(io.BytesIO):
    def __init__(self, files, path, mode):
        self.files, self.path, self.mode = files, path, mode
        super().__init__(files.get(path, b"") if "r" in mode else b"")

    def close(self):
        if "w" in self.mode:
            self.files[self.path] = self.getvalue()
        super().close()


def fake_client():
    client = MagicMock()
    sftp = client.open_sftp.return_value.__enter__.return_value
    sftp.normalize.return_value = "/jobs"
    sftp.stat.side_effect = lambda path: SimpleNamespace(
        st_mode=stat.S_IFDIR if path == "/jobs" else stat.S_IFREG,
        st_size=42,
    )
    files = {}
    sftp.open.side_effect = lambda path, mode: ProbeFile(files, path, mode)
    sftp.remove.side_effect = lambda path: files.pop(path)
    return client, sftp, files


def test_connector_roundtrip_cleanup_and_disabled_implicit_keys(tmp_path, monkeypatch):
    key = tmp_path / "key"
    key.write_text("not a real key", encoding="utf-8")
    client, sftp, files = fake_client()
    monkeypatch.setattr("app.autodl.run_python_probe", lambda *_: None)
    result = AutoDLConnector(settings(tmp_path), lambda: client).check(
        config(private_key_path=str(key))
    )
    assert result["success"] is True
    assert len(result["checks"]) == 6
    assert files == {}
    sftp.remove.assert_called_once()
    assert client.connect.call_args.kwargs["allow_agent"] is False
    assert client.connect.call_args.kwargs["look_for_keys"] is False
    assert client.connect.call_args.kwargs["auth_timeout"] == 10
    client.close.assert_called_once()


def test_connector_cleans_probe_on_corrupt_transfer(tmp_path):
    key = tmp_path / "key"
    key.write_text("test", encoding="utf-8")
    client, sftp, files = fake_client()
    original_open = sftp.open.side_effect
    sftp.open.side_effect = lambda path, mode: (
        io.BytesIO(b"corrupt") if "r" in mode else original_open(path, mode)
    )
    report = AutoDLConnector(settings(tmp_path), lambda: client).check(
        config(private_key_path=str(key))
    )
    assert report["code"] == "transfer_integrity"
    assert files == {}
    client.close.assert_called_once()


def test_error_does_not_return_sensitive_exception_text(tmp_path):
    key = tmp_path / "key"
    key.write_text("test", encoding="utf-8")
    client, _, _ = fake_client()
    client.connect.side_effect = paramiko.AuthenticationException(
        "SECRET PASSWORD AND PRIVATE PATH"
    )
    result = AutoDLConnector(settings(tmp_path), lambda: client).check(
        config(private_key_path=str(key))
    )
    assert result["code"] == "authentication"
    assert "SECRET" not in json.dumps(result)
    client.close.assert_called_once()


def test_python_probe_quotes_paths_without_executing_entry():
    client = MagicMock()
    stdin, stdout, stderr = MagicMock(), MagicMock(), MagicMock()
    client.exec_command.return_value = (stdin, stdout, stderr)
    channel = stdout.channel
    channel.recv_ready.side_effect = [True, False, False]
    channel.recv.return_value = b'{"python":[3,10,4],"entry_syntax":true}'
    channel.recv_stderr_ready.return_value = False
    channel.exit_status_ready.return_value = True
    channel.recv_exit_status.return_value = 0
    selected = config(algorithm_entry="/project/a '; exit 1; echo '.py")
    run_python_probe(client, selected)
    args = shlex.split(client.exec_command.call_args.args[0])
    assert args[0] == "python"
    assert args[-1] == selected.algorithm_entry
    assert "ast.parse" in args[2]
    assert "exec(" not in args[2]
    channel.close.assert_called_once()


def test_total_timeout_closes_blocked_connection(tmp_path, monkeypatch):
    key = tmp_path / "key"
    key.write_text("test", encoding="utf-8")
    client, _, _ = fake_client()
    closed = threading.Event()
    client.close.side_effect = closed.set

    def stalled(**kwargs):
        assert closed.wait(timeout=1)
        raise EOFError()

    client.connect.side_effect = stalled
    monkeypatch.setattr("app.autodl.CHECK_TIMEOUT", 0.01)
    report = AutoDLConnector(settings(tmp_path), lambda: client).check(
        config(private_key_path=str(key))
    )
    assert report["code"] == "check_timeout"
    assert report["success"] is False
