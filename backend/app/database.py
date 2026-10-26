import sqlite3
from pathlib import Path


def initialize_database(storage_dir: Path) -> None:
    storage_dir.mkdir(parents=True, exist_ok=True)
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    with sqlite3.connect(storage_dir / "app.sqlite3") as connection:
        connection.executescript(schema)
