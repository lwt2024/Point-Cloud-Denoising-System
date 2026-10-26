"""Local accounts with scrypt password hashes and revocable database-backed sessions."""

import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator

from app.config import Settings

COOKIE_NAME = "pcds_session"
SESSION_SECONDS = 8 * 60 * 60


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=32)
    password: SecretStr = Field(min_length=10, max_length=128)

    @field_validator("username")
    @classmethod
    def username_valid(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}", value):
            raise ValueError("Use 3-32 letters, numbers, underscores, dots or hyphens")
        return value.lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=32768, r=8, p=3, maxmem=64 * 1024 * 1024, dklen=32
    )
    return f"scrypt$32768$8$3${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if (algorithm, n, r, p) != ("scrypt", "32768", "8", "3"):
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt),
            n=32768,
            r=8,
            p=3,
            maxmem=64 * 1024 * 1024,
            dklen=32,
        )
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


DUMMY_HASH = hash_password(secrets.token_urlsafe(24))


def fail(status, code, message, headers=None):
    raise HTTPException(status, detail={"code": code, "message": message}, headers=headers)


class AuthService:
    def __init__(self, settings: Settings):
        self.settings = settings

    @contextmanager
    def database(self):
        connection = sqlite3.connect(self.settings.storage_dir / "app.sqlite3", timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def ensure_admin(self):
        if not self.settings.admin_password:
            return
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT id FROM users WHERE role='admin'").fetchone():
                return  # Deployment credentials never reset an existing account.
            try:
                credentials = Credentials(
                    username=self.settings.admin_username, password=self.settings.admin_password
                )
            except ValidationError:
                raise RuntimeError("管理员初始用户名或密码格式无效，请检查本机部署配置。") from None
            if db.execute(
                "SELECT id FROM users WHERE username=?", (credentials.username,)
            ).fetchone():
                raise RuntimeError("管理员用户名已被普通账号使用，请修改部署配置中的管理员用户名。")
            db.execute(
                "INSERT INTO users VALUES (?, ?, ?, 'admin', 0, ?)",
                (
                    secrets.token_hex(16),
                    credentials.username,
                    hash_password(credentials.password.get_secret_value()),
                    datetime.now(UTC).isoformat(),
                ),
            )

    def check_origin(self, request: Request):
        origin = request.headers.get("origin")
        if origin and origin not in self.settings.cors_origins:
            fail(403, "origin", "该页面来源未获授权。")

    def require_write(self, request: Request):
        self.check_origin(request)
        if request.headers.get("x-pcds-csrf") != "1":
            fail(403, "csrf", "请求校验失败，请刷新页面后重试。")

    def throttle(self, bucket: str, limit: int, window: int):
        now = time.time()
        bucket = hashlib.sha256(bucket.encode()).hexdigest()
        with self.database() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT started_at, count FROM auth_attempts WHERE bucket=?", (bucket,)
            ).fetchone()
            if row and now - row["started_at"] < window:
                if row["count"] >= limit:
                    retry = max(1, int(window - (now - row["started_at"])))
                    fail(
                        429, "rate_limit", "尝试次数过多，请稍后再试。", {"Retry-After": str(retry)}
                    )
                db.execute("UPDATE auth_attempts SET count=count+1 WHERE bucket=?", (bucket,))
            else:
                db.execute("INSERT OR REPLACE INTO auth_attempts VALUES (?, ?, 1)", (bucket, now))
            db.execute("DELETE FROM auth_attempts WHERE started_at < ?", (now - 86400,))

    @staticmethod
    def public_user(row):
        return {"id": row["id"], "username": row["username"], "role": row["role"]}

    def current_user(self, request: Request):
        token = request.cookies.get(COOKIE_NAME, "")
        if not token or len(token) > 128:
            fail(401, "session_expired", "请登录后继续。")
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.database() as db:
            row = db.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id "
                "WHERE token_hash=? AND expires_at>? AND users.disabled=0",
                (digest, time.time()),
            ).fetchone()
        if not row:
            fail(401, "session_expired", "登录已失效，请重新登录。")
        return self.public_user(row)

    def require_admin(self, request: Request):
        user = self.current_user(request)
        self.check_origin(request)
        if request.method not in {"GET", "HEAD"}:
            self.require_write(request)
        if user["role"] != "admin":
            fail(403, "admin_required", "此操作仅限管理员。")
        return user

    def create_session(self, response: Response, user_id: str, previous: str):
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self.database() as db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            if previous:
                db.execute(
                    "DELETE FROM sessions WHERE token_hash=?",
                    (hashlib.sha256(previous.encode()).hexdigest(),),
                )
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?)",
                (
                    hashlib.sha256(token.encode()).hexdigest(),
                    user_id,
                    now,
                    now + SESSION_SECONDS,
                ),
            )
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=SESSION_SECONDS,
            httponly=True,
            secure=self.settings.cookie_secure,
            samesite="lax",
            path="/api",
        )
        response.headers["Cache-Control"] = "no-store"

    def router(self):
        router = APIRouter(prefix="/api/auth", tags=["accounts"])

        @router.post("/register", status_code=201, dependencies=[Depends(self.require_write)])
        def register(credentials: Credentials, request: Request):
            ip = request.client.host if request.client else "unknown"
            self.throttle("register:" + ip, 20, 3600)
            password_hash = hash_password(credentials.password.get_secret_value())
            with self.database() as db:
                try:
                    db.execute(
                        "INSERT INTO users VALUES (?, ?, ?, 'user', 0, ?)",
                        (
                            secrets.token_hex(16),
                            credentials.username,
                            password_hash,
                            datetime.now(UTC).isoformat(),
                        ),
                    )
                except sqlite3.IntegrityError:
                    fail(409, "username_taken", "该用户名已被使用。")
            return {"message": "注册成功，请使用新账号登录。"}

        @router.post("/login", dependencies=[Depends(self.require_write)])
        def login(credentials: Credentials, request: Request, response: Response):
            ip = request.client.host if request.client else "unknown"
            self.throttle("login-ip:" + ip, 40, 300)
            self.throttle("login-account:" + credentials.username, 8, 300)
            with self.database() as db:
                row = db.execute(
                    "SELECT * FROM users WHERE username=?", (credentials.username,)
                ).fetchone()
            valid = verify_password(
                credentials.password.get_secret_value(), row["password_hash"] if row else DUMMY_HASH
            )
            if not row or not valid or row["disabled"]:
                fail(401, "invalid_credentials", "用户名或密码错误，或账号已停用。")
            self.create_session(response, row["id"], request.cookies.get(COOKIE_NAME, ""))
            with self.database() as db:
                db.execute(
                    "DELETE FROM auth_attempts WHERE bucket=?",
                    (
                        hashlib.sha256(
                            ("login-account:" + credentials.username).encode()
                        ).hexdigest(),
                    ),
                )
            return {"user": self.public_user(row)}

        @router.get("/me")
        def me(request: Request, response: Response):
            response.headers["Cache-Control"] = "no-store"
            return {"user": self.current_user(request)}

        @router.post("/logout", dependencies=[Depends(self.require_write)])
        def logout(request: Request, response: Response):
            token = request.cookies.get(COOKIE_NAME, "")
            with self.database() as db:
                db.execute(
                    "DELETE FROM sessions WHERE token_hash=?",
                    (hashlib.sha256(token.encode()).hexdigest(),),
                )
            response.delete_cookie(
                COOKIE_NAME,
                path="/api",
                httponly=True,
                secure=self.settings.cookie_secure,
                samesite="lax",
            )
            response.headers["Cache-Control"] = "no-store"
            return {"message": "已退出登录。"}

        return router
