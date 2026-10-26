import hashlib
import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from app.auth import COOKIE_NAME, hash_password, verify_password
from app.config import Settings
from app.main import create_app

PASSWORD = "research-password-2026"
CSRF = {"X-PCDS-CSRF": "1"}


def app_for(tmp_path, **kwargs):
    return create_app(
        Settings(tmp_path, ("http://localhost:5173",), admin_password=PASSWORD, **kwargs)
    )


def login(client, username="admin", password=PASSWORD):
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}, headers=CSRF
    )


def register(client, username="researcher", **extras):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, **extras},
        headers=CSRF,
    )


def test_password_hash_uses_unique_salt():
    first = hash_password(PASSWORD)
    second = hash_password(PASSWORD)
    assert first != second
    assert PASSWORD not in first
    assert verify_password(PASSWORD, first)
    assert not verify_password("wrong", first)
    assert not verify_password(PASSWORD, "not-a-hash")


def test_admin_login_cookie_and_logout_revocation(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        assert client.get("/api/auth/me").status_code == 401
        assert login(client, password="invalid-password").status_code == 401
        response = login(client)
        assert response.json()["user"]["role"] == "admin"
        cookie = response.headers["set-cookie"]
        assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/api" in cookie
        token = client.cookies.get(COOKIE_NAME)
        assert token not in response.text
        assert client.get("/api/auth/me").json()["user"]["username"] == "admin"
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            row = db.execute("SELECT token_hash FROM sessions").fetchone()
            assert row[0] == hashlib.sha256(token.encode()).hexdigest()
        assert client.post("/api/auth/logout", headers=CSRF).status_code == 200
        assert (
            client.get("/api/auth/me", headers={"Cookie": f"{COOKIE_NAME}={token}"}).status_code
            == 401
        )


def test_registration_is_normalized_user_only_and_password_is_hashed(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        assert register(client, "Alice_01").status_code == 201
        assert register(client, "alice_01").status_code == 409
        assert register(client, "elevated", role="admin").status_code == 422
        assert login(client, "ALICE_01").json()["user"]["role"] == "user"
        assert client.get("/api/admin/autodl").status_code == 403
        assert (
            client.put("/api/admin/autodl", headers=CSRF, json={"host": "example.com"}).status_code
            == 403
        )
        assert client.post("/api/admin/autodl/test", headers=CSRF).status_code == 403
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            stored = db.execute(
                "SELECT password_hash FROM users WHERE username='alice_01'"
            ).fetchone()[0]
            assert stored.startswith("scrypt$") and PASSWORD not in stored
            assert db.execute("SELECT count(*) FROM users WHERE role='admin'").fetchone()[0] == 1


def test_sessions_survive_restart_and_expire(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        login(client)
        token = client.cookies.get(COOKIE_NAME)
    with TestClient(app_for(tmp_path)) as restarted:
        cookie = {"Cookie": f"{COOKIE_NAME}={token}"}
        assert restarted.get("/api/auth/me", headers=cookie).status_code == 200
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            db.execute("UPDATE sessions SET expires_at=?", (time.time() - 1,))
        assert restarted.get("/api/auth/me", headers=cookie).status_code == 401


def test_disabled_user_session_stops_working(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        login(client)
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            db.execute("UPDATE users SET disabled=1 WHERE username='admin'")
        assert client.get("/api/auth/me").status_code == 401
        assert client.get("/api/admin/autodl").status_code == 401
        assert login(client).status_code == 401


def test_login_rotates_session_and_rejects_forged_session(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        login(client)
        old = client.cookies.get(COOKIE_NAME)
        login(client)
        assert client.cookies.get(COOKIE_NAME) != old
        assert (
            client.get("/api/auth/me", headers={"Cookie": f"{COOKIE_NAME}={old}"}).status_code
            == 401
        )
        assert (
            client.get("/api/auth/me", headers={"Cookie": f"{COOKIE_NAME}=forged"}).status_code
            == 401
        )


def test_csrf_origin_and_deprecated_token_cannot_bypass_login(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        assert (
            client.post(
                "/api/auth/login", json={"username": "admin", "password": PASSWORD}
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/auth/login",
                headers={**CSRF, "Origin": "https://evil.example"},
                json={"username": "admin", "password": PASSWORD},
            ).status_code
            == 403
        )
        login(client)
        assert client.post("/api/auth/logout").status_code == 403
        assert client.post("/api/admin/autodl/test").status_code == 403
    with TestClient(app_for(tmp_path)) as anonymous:
        assert (
            anonymous.get(
                "/api/admin/autodl", headers={"Authorization": "Bearer " + "x" * 48}
            ).status_code
            == 401
        )


def test_failed_logins_are_rate_limited_persistently(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        for _ in range(8):
            assert login(client, password="wrong-password").status_code == 401
        response = login(client)
        assert response.status_code == 429
        assert int(response.headers["retry-after"]) > 0
    with TestClient(app_for(tmp_path)) as restarted:
        assert login(restarted).status_code == 429


def test_initial_admin_is_not_reset_by_restart(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        login(client)
    replacement = Settings(tmp_path, (), admin_password="different-initial-password")
    with TestClient(create_app(replacement)) as restarted:
        assert login(restarted).status_code == 200
        assert login(restarted, password=replacement.admin_password).status_code == 401


def test_password_validation_is_not_reflected_and_secure_cookie_option(tmp_path):
    with TestClient(app_for(tmp_path, cookie_secure=True), base_url="https://testserver") as client:
        response = client.post(
            "/api/auth/register", headers=CSRF, json={"username": "test", "password": "short"}
        )
        assert response.status_code == 422 and "short" not in response.text
        assert "Secure" in login(client).headers["set-cookie"]


def test_existing_database_schema_accepts_additive_session_tables(tmp_path):
    app = app_for(tmp_path)
    with TestClient(app) as client:
        assert register(client).status_code == 201
    with TestClient(app_for(tmp_path)) as restarted:
        assert login(restarted, "researcher").status_code == 200


def test_invalid_bootstrap_password_is_not_printed_in_error(tmp_path):
    settings = Settings(tmp_path, (), admin_password="tiny")
    with (
        pytest.raises(RuntimeError, match="管理员初始用户名或密码格式无效") as failure,
        TestClient(create_app(settings)),
    ):
        pass
    assert "tiny" not in str(failure.value)
