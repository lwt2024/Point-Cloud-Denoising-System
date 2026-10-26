"""Create a local admin token without printing it or replacing existing configuration."""

import os
import secrets

from dotenv import dotenv_values

from app.config import ROOT


def main():
    path = ROOT / ".env"
    values = dotenv_values(path) if path.exists() else {}
    if values.get("PCDS_ADMIN_TOKEN"):
        print("Administrator token already exists in .env; no changes made.")
        return
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = [line for line in existing.splitlines() if not line.startswith("PCDS_ADMIN_TOKEN=")]
    token = secrets.token_urlsafe(36)
    with path.open("w", encoding="utf-8") as output:
        os.chmod(path, 0o600)
        output.write("\n".join(lines) + "\nPCDS_ADMIN_TOKEN=" + token + "\n")
    print(
        "Administrator token created in repository .env. Restart backend, then use System Settings."
    )
    print("The token is not printed. Read it locally; do not share it or commit .env.")


if __name__ == "__main__":
    main()
