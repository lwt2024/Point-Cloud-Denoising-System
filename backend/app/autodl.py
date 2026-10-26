"""Admin-only AutoDL configuration and bounded SSH/SFTP readiness checks."""

import base64
import hashlib
import hmac
import json
import os
import re
import shlex
import socket
import stat
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

import paramiko
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import Settings

CHECK_TTL = 300
CHECK_TIMEOUT = 60
STAGE_LABELS = {
    "ssh": "SSH 认证与服务器身份",
    "sftp": "SFTP 通道",
    "work_dir": "远端工作目录",
    "transfer": "SFTP 写入、回读与探测文件清理",
    "entry": "Python 3 与算法入口语法",
    "models": "模型文件与版本配置",
}
CONNECT_TIMEOUT = 10
OPERATION_TIMEOUT = 15


class RemoteConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(default="root", min_length=1, max_length=64)
    auth_mode: str = "key"
    private_key_path: str = Field(default="", max_length=1024)
    known_hosts_path: str = Field(default="", max_length=1024)
    host_fingerprint: str = Field(default="", max_length=100)
    work_dir: str = "/root/autodl-tmp/pointcloud-jobs"
    python_path: str = "python"
    algorithm_entry: str = ""
    pcn_checkpoint: str = ""
    pdlts_checkpoint: str = ""
    algorithm_version: str = Field(default="", max_length=120)
    model_version: str = Field(default="", max_length=120)
    config_version: str = Field(default="", max_length=120)

    @field_validator("host")
    @classmethod
    def host_valid(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", value):
            raise ValueError("Enter a host name or IP address, without ssh, user or port")
        return value

    @field_validator("username")
    @classmethod
    def username_valid(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
            raise ValueError("Invalid SSH username")
        return value

    @field_validator("auth_mode")
    @classmethod
    def auth_valid(cls, value):
        if value != "key":
            raise ValueError("Use SSH private-key authentication")
        return value

    @field_validator("host_fingerprint")
    @classmethod
    def fingerprint_valid(cls, value):
        if value and not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", value):
            raise ValueError("Expected an OpenSSH SHA256 fingerprint")
        return value

    @field_validator("work_dir", "algorithm_entry", "pcn_checkpoint", "pdlts_checkpoint")
    @classmethod
    def remote_path_valid(cls, value):
        if value and (
            len(value) > 1024
            or not value.startswith("/")
            or value == "/"
            or ".." in PurePosixPath(value).parts
            or any(ord(c) < 32 for c in value)
        ):
            raise ValueError("Expected an absolute remote path, outside the root directory")
        return value

    @field_validator("python_path")
    @classmethod
    def python_valid(cls, value):
        if not value or len(value) > 1024 or any(ord(c) < 32 for c in value):
            raise ValueError("Invalid Python executable")
        if not value.startswith("/") and value not in {"python", "python3"}:
            raise ValueError("Use python, python3, or an absolute executable path")
        return value

    @field_validator("private_key_path", "known_hosts_path")
    @classmethod
    def local_path_valid(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError("Invalid local file path")
        return value


class RemoteError(Exception):
    def __init__(self, code: str, message: str, fingerprint: str | None = None):
        self.code = code
        self.message = message
        self.fingerprint = fingerprint
        super().__init__(message)


def fingerprint(key) -> str:
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


class PinnedHostKey(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected: str):
        self.expected = expected

    def missing_host_key(self, client, hostname, key):
        actual = fingerprint(key)
        if self.expected and hmac.compare_digest(self.expected, actual):
            return
        if self.expected:
            raise RemoteError("host_key_changed", "服务器指纹与已核验指纹不符，连接已拒绝。")
        raise RemoteError(
            "host_key_untrusted",
            "服务器尚未受信任。请通过可信渠道核对以下 SHA256 指纹后填写并保存。",
            actual,
        )


def run_python_probe(client, config: RemoteConfig) -> None:
    # Parse source without importing or running the algorithm / allocating GPU memory.
    script = (
        "import ast,json,sys; "
        "source=open(sys.argv[1],encoding='utf-8-sig').read(5242881); "
        "assert len(source)<=5242880, 'entry too large'; "
        "ast.parse(source); "
        "print(json.dumps({'python':sys.version_info[:3],'entry_syntax':True}))"
    )
    command = " ".join(
        shlex.quote(arg)
        for arg in [
            config.python_path,
            "-c",
            script,
            config.algorithm_entry,
        ]
    )
    stdin, stdout, stderr = client.exec_command(command, timeout=OPERATION_TIMEOUT)
    stdin.close()
    channel = stdout.channel
    output = bytearray()
    deadline = time.monotonic() + OPERATION_TIMEOUT
    try:
        while True:
            while channel.recv_ready():
                if time.monotonic() > deadline:
                    raise RemoteError("probe_timeout", "Python 检查超时。")
                output.extend(channel.recv(4096))
                if len(output) > 8192:
                    raise RemoteError("probe_output", "Python 检查输出异常，请检查解释器配置。")
            while channel.recv_stderr_ready():
                if time.monotonic() > deadline:
                    raise RemoteError("probe_timeout", "Python 检查超时。")
                channel.recv_stderr(
                    4096
                )  # Never return raw stderr, which can contain paths/secrets.
            if time.monotonic() > deadline:
                raise RemoteError("probe_timeout", "Python / 算法入口检查超时。")
            if channel.exit_status_ready() and not channel.recv_ready():
                break
            time.sleep(0.02)
        if channel.recv_exit_status() != 0:
            raise RemoteError("entry_check", "Python 无法解析算法入口，请检查解释器与脚本语法。")
        try:
            info = json.loads(output)
            if not info.get("entry_syntax") or info["python"][0] != 3:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise RemoteError(
                "python_check", "Python 检查未返回有效结果，需要 Python 3。"
            ) from None
    finally:
        channel.close()
        stdout.close()
        stderr.close()


class AutoDLConnector:
    def __init__(self, settings: Settings, client_factory=paramiko.SSHClient):
        self.settings = settings
        self.client_factory = client_factory

    def check(self, config: RemoteConfig) -> dict:
        checks = []
        started = time.monotonic()
        client = None
        timer = None
        expired = threading.Event()
        stage = "ssh"
        try:
            client = self.client_factory()

            def expire():
                expired.set()
                client.close()

            timer = threading.Timer(CHECK_TIMEOUT, expire)
            timer.daemon = True
            timer.start()
            client.set_missing_host_key_policy(PinnedHostKey(config.host_fingerprint))
            if config.known_hosts_path:
                known_hosts = Path(config.known_hosts_path).expanduser()
                if not known_hosts.is_file():
                    raise RemoteError("known_hosts_missing", "本机 known_hosts 文件不存在。")
                client.load_host_keys(str(known_hosts))
            kwargs = {
                "hostname": config.host,
                "port": config.port,
                "username": config.username,
                "timeout": CONNECT_TIMEOUT,
                "banner_timeout": CONNECT_TIMEOUT,
                "auth_timeout": CONNECT_TIMEOUT,
                "channel_timeout": CONNECT_TIMEOUT,
                "allow_agent": False,
                "look_for_keys": False,
            }
            key_path = Path(config.private_key_path).expanduser()
            if not config.private_key_path or not key_path.is_file():
                raise RemoteError("key_missing", "SSH 私钥文件不存在，请填写本机私钥文件路径。")
            kwargs.update(
                key_filename=str(key_path), passphrase=self.settings.ssh_key_passphrase or None
            )
            client.connect(**kwargs)
            # Also enforce explicit pin if a known_hosts entry was used.
            if config.host_fingerprint:
                actual = fingerprint(client.get_transport().get_remote_server_key())
                if not hmac.compare_digest(config.host_fingerprint, actual):
                    raise RemoteError("host_key_changed", "服务器指纹发生变化，连接已拒绝。")
            checks.append({"id": stage, "label": "SSH 认证与服务器身份", "status": "passed"})
            stage = "sftp"
            with client.open_sftp() as sftp:
                sftp.get_channel().settimeout(OPERATION_TIMEOUT)
                checks.append({"id": stage, "label": "SFTP 通道", "status": "passed"})
                stage = "work_dir"
                if not config.work_dir:
                    raise RemoteError("work_dir_missing", "请填写远端任务工作目录。")
                root = sftp.normalize(config.work_dir)
                if root == "/" or not stat.S_ISDIR(sftp.stat(root).st_mode):
                    raise RemoteError("work_dir_invalid", "远端任务目录不存在或不是独立工作目录。")
                checks.append({"id": stage, "label": "远端工作目录", "status": "passed"})
                stage = "transfer"
                probe = str(PurePosixPath(root) / (".pcds-probe-" + uuid.uuid4().hex))
                content = os.urandom(64)
                created = False
                try:
                    with sftp.open(probe, "wx") as target:
                        created = True
                        target.write(content)
                    with sftp.open(probe, "rb") as source:
                        if source.read(65) != content:
                            raise RemoteError("transfer_integrity", "SFTP 写入与读取内容不一致。")
                finally:
                    if created:
                        sftp.remove(probe)
                checks.append(
                    {"id": stage, "label": "SFTP 写入、回读与探测文件清理", "status": "passed"}
                )
                stage = "entry"
                if not config.algorithm_entry:
                    raise RemoteError("entry_missing", "请填写远端算法入口的绝对路径。")
                self.require_file(sftp, config.algorithm_entry)
                run_python_probe(client, config)
                checks.append({"id": stage, "label": "Python 3 与算法入口语法", "status": "passed"})
                stage = "models"
                if not config.pcn_checkpoint or not config.pdlts_checkpoint:
                    raise RemoteError("models_missing", "请填写 PCN 与 PD-LTS 模型文件路径。")
                for path in (config.pcn_checkpoint, config.pdlts_checkpoint):
                    self.require_file(sftp, path)
                if not all((config.algorithm_version, config.model_version, config.config_version)):
                    raise RemoteError("versions_missing", "请填写算法、模型与配置版本摘要。")
                checks.append({"id": stage, "label": "模型文件与版本配置", "status": "passed"})
            result = {
                "success": True,
                "code": "ready",
                "message": "连接与文件检查通过；尚未执行 GPU 推理。",
            }
        except (RemoteError, paramiko.SSHException, OSError, ValueError, EOFError) as error:
            code, message, pin = self.describe(error)
            if expired.is_set():
                code, message, pin = "check_timeout", "连接检查已超过 60 秒，已关闭连接。", None
            checks.append(
                {"id": stage, "label": STAGE_LABELS[stage], "status": "failed", "message": message}
            )
            result = {"success": False, "code": code, "message": message, "fingerprint": pin}
        finally:
            if timer:
                timer.cancel()
            if client:
                client.close()
        if expired.is_set() and result["success"]:
            result = {
                "success": False,
                "code": "check_timeout",
                "message": "连接检查超过 60 秒，请重试。",
            }
            checks.append({"id": "timeout", "label": "总检查时限", "status": "failed"})
        return {
            **result,
            "checks": checks,
            "duration_ms": round((time.monotonic() - started) * 1000),
        }

    @staticmethod
    def require_file(sftp, path):
        attributes = sftp.stat(path)
        if not stat.S_ISREG(attributes.st_mode) or attributes.st_size == 0:
            raise RemoteError("remote_file_invalid", "算法入口或模型文件不是有效的非空文件。")

    @staticmethod
    def describe(error):
        if isinstance(error, RemoteError):
            return error.code, error.message, error.fingerprint
        if isinstance(error, paramiko.BadHostKeyException):
            return "host_key_changed", "服务器 host key 与 known_hosts 不一致，连接已拒绝。", None
        if isinstance(error, paramiko.AuthenticationException):
            return "authentication", "SSH 认证失败，请检查用户名、私钥或本机密码配置。", None
        if isinstance(error, paramiko.PasswordRequiredException):
            return (
                "passphrase_required",
                "私钥需要口令，请在本机 .env 设置 AUTODL_KEY_PASSPHRASE。",
                None,
            )
        if isinstance(error, (socket.timeout, TimeoutError)):
            return "timeout", "连接或文件操作超时，请检查实例是否开机及端口是否正确。", None
        if isinstance(error, FileNotFoundError):
            return "path_missing", "本地或远端配置路径不存在，请检查目录、入口和模型路径。", None
        if isinstance(error, PermissionError):
            return "permission", "没有所需的文件或目录权限。", None
        if isinstance(error, (paramiko.SSHException, OSError)):
            return "connection", "SSH/SFTP 连接失败，请检查网络、端口、凭据和远端路径。", None
        return "check_failed", "连接检查失败，请核对配置后重试。", None


def atomic_json(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            os.chmod(temporary, 0o600)
            json.dump(value, output, ensure_ascii=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


class RemoteStore:
    """One process owns configuration; checks are explicitly requested, never polled over SSH."""

    def __init__(self, settings: Settings, connector=None):
        self.settings = settings
        self.path = settings.storage_dir / "autodl" / "config.json"
        self.report_path = self.path.with_name("last-check.json")
        self.lock = threading.Lock()
        self.connector = connector or AutoDLConnector(settings)
        self.testing = False

    def read(self):
        return (
            RemoteConfig.model_validate_json(self.path.read_text(encoding="utf-8"))
            if self.path.exists()
            else None
        )

    @staticmethod
    def digest(config):
        return hashlib.sha256(config.model_dump_json().encode()).hexdigest()

    def save(self, config):
        if not self.lock.acquire(blocking=False):
            raise RemoteError("busy", "连接测试进行中，请等待完成后再修改配置。")
        try:
            atomic_json(self.path, config.model_dump())
            self.report_path.unlink(missing_ok=True)
        finally:
            self.lock.release()

    def report(self):
        return (
            json.loads(self.report_path.read_text(encoding="utf-8"))
            if self.report_path.exists()
            else None
        )

    def status(self):
        try:
            config = self.read()
            report = self.report()
            if self.testing:
                return "testing"
            if not config:
                return "unconfigured"
            if not report or report.get("config_digest") != self.digest(config):
                return "untested"
            if time.time() - report.get("checked_epoch", 0) > CHECK_TTL:
                return "stale"
            return "ready" if report.get("success") else "failed"
        except (ValueError, OSError):
            return "invalid"

    def test(self):
        if not self.lock.acquire(blocking=False):
            raise RemoteError("busy", "已有连接测试正在进行，请稍后重试。")
        try:
            config = self.read()
            if not config:
                raise RemoteError("not_configured", "请先保存 AutoDL 连接配置。")
            self.testing = True
            report = self.connector.check(config)
            report.update(
                checked_at=datetime.now(UTC).isoformat(),
                checked_epoch=time.time(),
                config_digest=self.digest(config),
            )
            atomic_json(self.report_path, report)
            return report
        finally:
            self.testing = False
            self.lock.release()
