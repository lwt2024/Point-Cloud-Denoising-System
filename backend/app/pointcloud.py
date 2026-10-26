"""Streaming XYZ validation; never resample or modify coordinates."""

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

INPUT_POINTS = 140_000
MAX_BYTES = 100 * 1024 * 1024  # MVP convention: 100 MiB


@dataclass(frozen=True)
class CloudSummary:
    point_count: int
    size_bytes: int
    sha256: str
    bbox_min: tuple[float, float, float]
    bbox_max: tuple[float, float, float]
    warnings: tuple[str, ...]


def validate_xyz(path: Path, *, reference: bool = False) -> CloudSummary:
    if path.suffix.lower() != ".xyz":
        raise ValueError("Only .xyz files are accepted")
    digest = hashlib.sha256()
    size = count = 0
    extra_columns = False
    lower = [math.inf] * 3
    upper = [-math.inf] * 3
    with path.open("rb") as source:
        while True:
            # Bounded reads reject a huge malformed line without loading the whole file.
            raw = source.readline(MAX_BYTES - size + 1)
            if not raw:
                break
            size += len(raw)
            if size > MAX_BYTES:
                raise ValueError("File exceeds 100 MiB")
            digest.update(raw)
            count += 1
            try:
                columns = raw.decode("utf-8-sig" if count == 1 else "utf-8").split()
                if len(columns) < 3:
                    raise ValueError("Expected at least three columns")
                xyz = [float(value) for value in columns[:3]]
                if not all(math.isfinite(value) for value in xyz):
                    raise ValueError("Coordinates must be finite")
            except (ValueError, UnicodeError) as error:
                raise ValueError(f"Invalid XYZ at line {count}") from error
            extra_columns |= len(columns) > 3
            for axis, value in enumerate(xyz):
                lower[axis] = min(lower[axis], value)
                upper[axis] = max(upper[axis], value)
            if not reference and count > INPUT_POINTS:
                raise ValueError(f"Input must contain exactly {INPUT_POINTS} points")
    if count == 0:
        raise ValueError("File is empty")
    if not reference and count != INPUT_POINTS:
        raise ValueError(f"Input must contain exactly {INPUT_POINTS} points; got {count}")
    warnings = ("Additional columns are ignored",) if extra_columns else ()
    return CloudSummary(count, size, digest.hexdigest(), tuple(lower), tuple(upper), warnings)
