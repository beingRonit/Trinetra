from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
from typing import Any
from urllib.parse import unquote


def _read_env_value(path: Path, key: str) -> str:
    if not path.exists():
        return ""

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        env_key, value = line.split("=", 1)
        if env_key.strip() == key:
            return value.strip().strip('"').strip("'")
    return ""


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "")
    if value:
        return unquote(value)

    repo_root = Path(__file__).resolve().parents[3]
    for env_path in (repo_root / "dapp" / ".env", repo_root / "pipeline" / ".env"):
        value = _read_env_value(env_path, "DATABASE_URL")
        if value:
            return unquote(value)

    return ""


class ProtectedRegistryRepo:
    TABLE = "image_features"

    async def list_by_user_email(self, email: str, limit: int = 100) -> list[dict[str, Any]]:
        normalized_email = email.strip().lower()
        if not normalized_email:
            return []

        database_url = _database_url()
        if not database_url:
            return []

        rows = self._fetch_rows(database_url, normalized_email, limit)

        records: list[dict[str, Any]] = []
        for row in rows:
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except json.JSONDecodeError:
                    metadata = {}
            if not isinstance(metadata, dict):
                continue

            records.append(self._row_to_dashboard_asset(row, metadata))

        return records

    async def delete_for_user_email(self, registry_id: str, email: str) -> bool:
        normalized_email = email.strip().lower()
        if not registry_id or not normalized_email:
            return False

        try:
            numeric_id = int(registry_id)
        except ValueError:
            return False

        database_url = _database_url()
        if not database_url:
            return False

        return self._delete_row(database_url, numeric_id, normalized_email)

    def _fetch_rows(self, database_url: str, email: str, limit: int) -> list[dict[str, Any]]:
        safe_email = email.replace("'", "''")
        safe_limit = max(1, min(int(limit), 100))
        query = f"""
            SELECT COALESCE(json_agg(row_to_json(registry_rows)), '[]'::json)
            FROM (
                SELECT id, media_id, phash, metadata, created_at
                FROM public.image_features
                WHERE metadata->>'user_email' = '{safe_email}'
                ORDER BY created_at DESC
                LIMIT {safe_limit}
            ) registry_rows;
        """
        result = subprocess.run(
            ["psql", database_url, "-t", "-A", "-c", query],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            return []

        try:
            parsed = json.loads(result.stdout.strip() or "[]")
        except json.JSONDecodeError:
            return []

        return parsed if isinstance(parsed, list) else []

    def _delete_row(self, database_url: str, registry_id: int, email: str) -> bool:
        safe_email = email.replace("'", "''")
        query = f"""
            DELETE FROM public.image_features
            WHERE id = {registry_id}
              AND metadata->>'user_email' = '{safe_email}'
            RETURNING id;
        """
        result = subprocess.run(
            ["psql", database_url, "-t", "-A", "-c", query],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if result.returncode != 0:
            return False

        return str(registry_id) in result.stdout.splitlines()

    def _row_to_dashboard_asset(self, row: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
        created_at = row.get("created_at")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()

        registry_id = str(row.get("id"))
        return {
            "id": f"registry-{registry_id}",
            "filename": metadata.get("filename") or f"Protected asset {registry_id}",
            "mime_type": metadata.get("mime_type") or "image/jpeg",
            "created_at": created_at or datetime.utcnow().isoformat(),
            "phash": row.get("phash"),
            "preview_url": metadata.get("preview_url") or "",
            "scan": None,
            "protected_asset_id": registry_id,
            "protected_owner": metadata.get("artist_name") or "Owner",
            "protected_fingerprint": f"TRI-{str(row.get('phash') or registry_id).upper()}",
            "protected_status": "Registered protected asset",
            "protected_issued_at": created_at or datetime.utcnow().isoformat(),
            "protected_captions": metadata.get("blip_captions") or [],
            "is_registry_only": True,
        }


protected_registry_repo = ProtectedRegistryRepo()
