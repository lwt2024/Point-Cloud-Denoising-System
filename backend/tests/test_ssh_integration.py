"""Real loopback SSH public-key authentication and SFTP, without external credentials."""

import json
import os
import posixpath
import socket
import threading
import time
from pathlib import Path

import paramiko
import pytest
from pydantic import SecretStr

from app.autodl import AutoDLConnector, RemoteConfig, fingerprint
from app.config import Settings


class SandboxSFTP(paramiko.SFTPServerInterface):
    def __init__(self, server, root):
        super().__init__(server)
        self.root = Path(root).resolve()

    def path(self, remote):
        result = (self.root / remote.lstrip("/")).resolve()
        if not result.is_relative_to(self.root):
            raise PermissionError()
        return result

    def canonicalize(self, path):
        return posixpath.normpath("/" + path.lstrip("/"))

    def stat(self, path):
        try:
            return paramiko.SFTPAttributes.from_stat(self.path(path).stat())
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno)

    def open(self, path, flags, attr):
        try:
            descriptor = os.open(self.path(path), flags, 0o600)
            mode = "wb" if flags & os.O_WRONLY else "rb"
            stream = os.fdopen(descriptor, mode)
            handle = paramiko.SFTPHandle(flags)
            handle.readfile = stream
            handle.writefile = stream
            return handle
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno)

    def remove(self, path):
        try:
            self.path(path).unlink()
            return paramiko.SFTP_OK
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno)


class SSHServer(paramiko.ServerInterface):
    def __init__(self, user_key):
        self.user_key = user_key
        self.auth_count = 0
        self.password_auth_count = 0

    def get_allowed_auths(self, username):
        return "publickey,password"

    def check_auth_password(self, username, password):
        self.password_auth_count += 1
        return (
            paramiko.AUTH_SUCCESSFUL
            if username == "root" and password == "loopback-only-password"
            else paramiko.AUTH_FAILED
        )

    def check_auth_publickey(self, username, key):
        self.auth_count += 1
        return (
            paramiko.AUTH_SUCCESSFUL
            if username == "root" and key == self.user_key
            else paramiko.AUTH_FAILED
        )

    def check_channel_request(self, kind, channel_id):
        return (
            paramiko.OPEN_SUCCEEDED
            if kind == "session"
            else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED
        )

    def check_channel_exec_request(self, channel, command):
        # Simulated Python response over a real SSH execution channel; no GPU/algorithm execution.
        def respond():
            time.sleep(0.05)
            channel.send(json.dumps({"python": [3, 12, 0], "entry_syntax": True}).encode())
            channel.send_exit_status(0)
            channel.close()

        threading.Thread(target=respond, daemon=True).start()
        return True


@pytest.fixture
def ssh_server(tmp_path):
    root = tmp_path / "remote"
    (root / "jobs").mkdir(parents=True)
    (root / "entry.py").write_text("print('test')", encoding="utf-8")
    (root / "pcn.pth").write_bytes(b"test weights")
    (root / "pdlts.ckpt").write_bytes(b"test weights")
    host_key = paramiko.RSAKey.generate(2048)
    user_key = paramiko.RSAKey.generate(2048)
    private_key = tmp_path / "user-key"
    user_key.write_private_key_file(str(private_key))
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(2)
    listener.settimeout(0.2)
    server = SSHServer(user_key)
    stop = threading.Event()
    transports = []

    def serve():
        while not stop.is_set():
            try:
                connection, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            transport = paramiko.Transport(connection)
            transports.append(transport)
            transport.add_server_key(host_key)
            transport.set_subsystem_handler(
                "sftp", paramiko.SFTPServer, SandboxSFTP, root=str(root)
            )
            try:
                transport.start_server(server=server)
            except (paramiko.SSHException, EOFError, OSError):
                transport.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    config = RemoteConfig(
        host="127.0.0.1",
        port=listener.getsockname()[1],
        username="root",
        private_key_path=str(private_key),
        host_fingerprint=fingerprint(host_key),
        work_dir="/jobs",
        algorithm_entry="/entry.py",
        pcn_checkpoint="/pcn.pth",
        pdlts_checkpoint="/pdlts.ckpt",
        algorithm_version="a1",
        model_version="m1",
        config_version="c1",
    )
    yield config, server, root
    stop.set()
    listener.close()
    for transport in transports:
        transport.close()
    thread.join(timeout=2)


def test_real_ssh_and_sftp_roundtrip(ssh_server, tmp_path):
    config, server, root = ssh_server
    report = AutoDLConnector(Settings(tmp_path, ())).check(config)
    assert report["success"], report
    assert server.auth_count > 0
    assert list((root / "jobs").iterdir()) == []


def test_unknown_server_rejected_before_authentication(ssh_server, tmp_path):
    config, server, _ = ssh_server
    report = AutoDLConnector(Settings(tmp_path, ())).check(
        config.model_copy(update={"host_fingerprint": ""})
    )
    assert report["code"] == "host_key_untrusted"
    assert report["fingerprint"] == config.host_fingerprint
    assert server.auth_count == 0


def test_changed_fingerprint_rejected_before_authentication(ssh_server, tmp_path):
    config, server, _ = ssh_server
    report = AutoDLConnector(Settings(tmp_path, ())).check(
        config.model_copy(update={"host_fingerprint": "SHA256:" + "A" * 43})
    )
    assert report["code"] == "host_key_changed"
    assert server.auth_count == 0


def test_encrypted_private_key_uses_backend_passphrase(ssh_server, tmp_path):
    config, _, _ = ssh_server
    key = paramiko.RSAKey.from_private_key_file(config.private_key_path)
    key.write_private_key_file(config.private_key_path, password="local-test-passphrase")
    report = AutoDLConnector(
        Settings(tmp_path, (), ssh_key_passphrase="local-test-passphrase")
    ).check(config)
    assert report["success"], report


def test_password_login_without_key_or_deployment_paths(ssh_server, tmp_path):
    config, server, root = ssh_server
    selected = config.model_copy(
        update={
            "auth_mode": "password",
            "private_key_path": "",
            "work_dir": "/missing-dir",
            "algorithm_entry": "",
            "pcn_checkpoint": "",
            "pdlts_checkpoint": "",
        }
    )
    report = AutoDLConnector(Settings(tmp_path, ())).check(
        selected, SecretStr("loopback-only-password"), scope="connection"
    )
    assert report["success"], report
    assert report["code"] == "connected"
    assert len(report["checks"]) == 2
    assert server.password_auth_count > 0
    assert server.auth_count == 0
    assert list((root / "jobs").iterdir()) == []


def test_password_authentication_failure_is_sanitized(ssh_server, tmp_path):
    config, _, _ = ssh_server
    report = AutoDLConnector(Settings(tmp_path, ())).check(
        config.model_copy(update={"auth_mode": "password", "private_key_path": ""}),
        SecretStr("wrong-sensitive-password"),
        scope="connection",
    )
    assert report["code"] == "authentication"
    assert "wrong-sensitive-password" not in json.dumps(report)


def test_password_is_not_sent_to_untrusted_server(ssh_server, tmp_path):
    config, server, _ = ssh_server
    report = AutoDLConnector(Settings(tmp_path, ())).check(
        config.model_copy(
            update={"auth_mode": "password", "private_key_path": "", "host_fingerprint": ""}
        ),
        SecretStr("loopback-only-password"),
        scope="connection",
    )
    assert report["code"] == "host_key_untrusted"
    assert server.password_auth_count == 0
