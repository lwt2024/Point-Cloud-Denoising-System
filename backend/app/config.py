"""Backend-only configuration. No credentials are returned to the browser."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    storage_dir: Path
    cors_origins: tuple[str, ...]
    admin_token: str = ""  # Legacy configuration field; never used for authentication.
    ssh_key_passphrase: str = ""
    admin_username: str = "admin"
    admin_password: str = ""
    cookie_secure: bool = False


def load_settings() -> Settings:
    load_dotenv(ROOT / ".env")
    storage = Path(os.getenv("PCDS_STORAGE_DIR", "storage"))
    if not storage.is_absolute():
        storage = ROOT / storage
    origins = os.getenv("PCDS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return Settings(
        storage,
        tuple(x.strip() for x in origins.split(",") if x.strip()),
        os.getenv("PCDS_ADMIN_TOKEN", ""),
        os.getenv("AUTODL_KEY_PASSPHRASE", ""),
        os.getenv("PCDS_ADMIN_USERNAME", "admin"),
        os.getenv("PCDS_ADMIN_PASSWORD", ""),
        os.getenv("PCDS_COOKIE_SECURE", "false").lower() == "true",
    )
