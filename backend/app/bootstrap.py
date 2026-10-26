"""Create initial administrator deployment credentials without printing secrets."""

import os
import secrets

from dotenv import dotenv_values

from app.config import ROOT


def main():
    path = ROOT / ".env"
    values = dotenv_values(path) if path.exists() else {}
    additions = {}
    if not values.get("PCDS_ADMIN_USERNAME"):
        additions["PCDS_ADMIN_USERNAME"] = "admin"
    if not values.get("PCDS_ADMIN_PASSWORD"):
        additions["PCDS_ADMIN_PASSWORD"] = secrets.token_urlsafe(18)
    if not additions:
        print("Administrator deployment credentials already exist; no changes made.")
        return
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = [
        line
        for line in existing.splitlines()
        if not any(line.startswith(key + "=") for key in additions)
    ]
    with path.open("w", encoding="utf-8") as output:
        os.chmod(path, 0o600)
        output.write(
            "\n".join(lines)
            + "\n"
            + "\n".join(key + "=" + value for key, value in additions.items())
            + "\n"
        )
    print("Administrator deployment credentials saved in .env. Restart backend, then sign in.")
    print("Secrets are not printed. Read them locally; do not share or commit .env.")


if __name__ == "__main__":
    main()
