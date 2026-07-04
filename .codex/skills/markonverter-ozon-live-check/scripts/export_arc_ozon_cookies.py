#!/usr/bin/env python3
"""Export Ozon cookies from Arc into Markonverter's local live-QA secret file."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("Missing Python package: cryptography") from exc


DEFAULT_REPO = Path("/Users/gogla/PycharmProjects/markonverter")
DEFAULT_ARC_COOKIES = Path.home() / "Library/Application Support/Arc/User Data/Default/Cookies"
ARC_SERVICE = "Arc Safe Storage"
ARC_ACCOUNT = "Arc"
SALT = b"saltysalt"
IV = b" " * 16
SAME_SITE = {-1: "Lax", 0: "None", 1: "Lax", 2: "Strict"}


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    cookie_db = args.arc_cookies.expanduser().resolve()
    output = args.output.expanduser().resolve() if args.output else repo / ".secrets/ozon-cookies.txt"

    if not cookie_db.exists():
        raise SystemExit(f"Arc cookie DB not found: {cookie_db}")

    password = read_arc_safe_storage(args.timeout)
    key = hashlib.pbkdf2_hmac("sha1", password, SALT, 1003, 16)

    output.parent.mkdir(parents=True, exist_ok=True)
    cookies, failures = export_ozon_cookies(cookie_db, key)
    if len(cookies) < args.min_count:
        raise SystemExit(f"ARC_OZON_COOKIE_EXPORT_TOO_SMALL count={len(cookies)} failures={failures}")

    tmp_output = output.with_suffix(output.suffix + ".tmp")
    tmp_output.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp_output, 0o600)
    tmp_output.replace(output)
    os.chmod(output, 0o600)

    domains = {}
    for cookie in cookies:
        domains[cookie["domain"]] = domains.get(cookie["domain"], 0) + 1
    domain_summary = ",".join(f"{domain}:{count}" for domain, count in sorted(domains.items()))
    print(f"ARC_OZON_COOKIES_REFRESHED count={len(cookies)} failures={failures} domains={domain_summary}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh Markonverter live-QA Ozon cookies from Arc.")
    parser.add_argument("--repo", type=Path, default=DEFAULT_REPO)
    parser.add_argument("--arc-cookies", type=Path, default=DEFAULT_ARC_COOKIES)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=int, default=300, help="Seconds to wait for the macOS Keychain prompt.")
    parser.add_argument("--min-count", type=int, default=10)
    return parser.parse_args()


def read_arc_safe_storage(timeout: int) -> bytes:
    try:
        proc = subprocess.run(
            ["security", "find-generic-password", "-a", ARC_ACCOUNT, "-s", ARC_SERVICE, "-w"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SystemExit("ARC_KEYCHAIN_READ_TIMEOUT: approve the macOS prompt and rerun") from exc

    if proc.returncode != 0:
        raise SystemExit("ARC_KEYCHAIN_READ_FAILED: approve the macOS prompt and rerun")
    password = proc.stdout.rstrip(b"\n")
    if not password:
        raise SystemExit("ARC_KEYCHAIN_EMPTY")
    return password


def export_ozon_cookies(cookie_db: Path, key: bytes) -> tuple[list[dict[str, object]], int]:
    with tempfile.TemporaryDirectory(prefix="markonverter-arc-cookies-") as tmp_dir:
        db_copy = Path(tmp_dir) / "Cookies"
        shutil.copy2(cookie_db, db_copy)
        conn = sqlite3.connect(str(db_copy))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            select host_key, name, value, encrypted_value, path, expires_utc,
                   is_secure, is_httponly, samesite
            from cookies
            where host_key like '%ozon.ru%' or host_key like '%ozon.kz%'
            order by host_key, name, path, expires_utc desc
            """
        ).fetchall()

    seen: set[tuple[str, str, str]] = set()
    cookies: list[dict[str, object]] = []
    failures = 0
    for row in rows:
        try:
            value = decrypt_cookie(row["host_key"], row["value"], row["encrypted_value"], key)
        except Exception:
            failures += 1
            continue

        identity = (row["host_key"], row["name"], row["path"] or "/")
        if identity in seen:
            continue
        seen.add(identity)

        cookie: dict[str, object] = {
            "name": row["name"],
            "value": value,
            "domain": row["host_key"],
            "path": row["path"] or "/",
            "secure": bool(row["is_secure"]),
            "httpOnly": bool(row["is_httponly"]),
            "sameSite": SAME_SITE.get(row["samesite"], "Lax"),
        }
        expires = chrome_time_to_epoch(row["expires_utc"])
        if expires > 0:
            cookie["expires"] = expires
        cookies.append(cookie)
    return cookies, failures


def decrypt_cookie(host: str, value: str, encrypted_value: bytes, key: bytes) -> str:
    if value:
        return value
    blob = bytes(encrypted_value)
    if not blob:
        return ""
    if blob.startswith((b"v10", b"v11")):
        blob = blob[3:]

    decryptor = Cipher(algorithms.AES(key), modes.CBC(IV), backend=default_backend()).decryptor()
    plain = decryptor.update(blob) + decryptor.finalize()
    pad = plain[-1]
    if pad < 1 or pad > 16 or plain[-pad:] != bytes([pad]) * pad:
        raise ValueError("invalid cookie padding")
    plain = plain[:-pad]

    host_digest = hashlib.sha256(host.encode()).digest()
    if plain.startswith(host_digest):
        plain = plain[32:]
    return plain.decode("utf-8")


def chrome_time_to_epoch(value: int) -> int:
    if not value:
        return -1
    epoch = int(value / 1_000_000 - 11_644_473_600)
    return epoch if epoch > 0 else -1


if __name__ == "__main__":
    sys.exit(main())
