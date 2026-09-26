from __future__ import annotations

import json
import logging
import shutil
import tarfile
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from bson import BSON, json_util
from pymongo import MongoClient

from app.core.config import get_settings

log = logging.getLogger("helpdesk.backup")


def _write_database_dump(target: Path) -> dict[str, int]:
    settings = get_settings()
    target.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}

    client = MongoClient(settings.mongo_uri, tz_aware=True, serverSelectionTimeoutMS=10000)
    try:
        client.admin.command("ping")
        database = client[settings.mongo_db]

        for collection_name in sorted(database.list_collection_names()):
            collection = database[collection_name]
            dump_file = target / f"{collection_name}.bson"
            count = 0
            with dump_file.open("wb") as fh:
                for document in collection.find({}):
                    fh.write(BSON.encode(document))
                    count += 1
            counts[collection_name] = count

            metadata = {
                "options": collection.options(),
                "indexes": list(collection.list_indexes()),
            }
            (target / f"{collection_name}.metadata.json").write_text(
                json_util.dumps(metadata, indent=2),
                encoding="utf-8",
            )
    finally:
        client.close()

    return counts


def _compress_attachments(target: Path) -> int:
    settings = get_settings()
    upload_dir = Path(settings.upload_dir).resolve()
    files = 0

    with tarfile.open(target, "w:gz") as archive:
        if upload_dir.exists():
            for path in sorted(upload_dir.rglob("*")):
                if path.is_file():
                    files += 1
            archive.add(upload_dir, arcname="uploads")

    return files


def _cleanup_old_backups(root: Path) -> None:
    settings = get_settings()
    cutoff = datetime.now(ZoneInfo(settings.timezone)) - timedelta(days=settings.backup_retention_days)

    for path in root.iterdir():
        if not path.is_dir() or path.name.startswith("."):
            continue
        try:
            modified = datetime.fromtimestamp(path.stat().st_mtime, tz=ZoneInfo(settings.timezone))
        except OSError:
            continue
        if modified < cutoff:
            shutil.rmtree(path, ignore_errors=True)


def create_backup() -> Path:
    settings = get_settings()
    timezone = ZoneInfo(settings.timezone)
    now = datetime.now(timezone)
    backup_root = Path(settings.backup_dir).resolve()
    backup_root.mkdir(parents=True, exist_ok=True)

    name = now.strftime("%Y%m%d-%H%M%S")
    final_dir = backup_root / name
    temp_dir = backup_root / f".{name}.tmp"

    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)

    try:
        database_dir = temp_dir / "database"
        counts = _write_database_dump(database_dir)
        attachment_count = _compress_attachments(temp_dir / "attachments.tar.gz")

        manifest = {
            "created_at": now.isoformat(),
            "database": settings.mongo_db,
            "collections": counts,
            "attachments_files": attachment_count,
            "database_format": "mongodump-compatible BSON files with collection metadata",
            "attachments_format": "tar.gz",
        }
        (temp_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        temp_dir.rename(final_dir)
        _cleanup_old_backups(backup_root)
        log.info("Respaldo diario creado en %s", final_dir)
        return final_dir
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    path = create_backup()
    print(path)


if __name__ == "__main__":
    main()
