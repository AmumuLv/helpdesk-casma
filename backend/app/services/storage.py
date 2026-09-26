import asyncio
import io
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models.ticket import AttachmentMeta

Image.MAX_IMAGE_PIXELS = 40_000_000
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "MPO"}
_MAX_SIDE = 1920


def _process(raw: bytes, target: Path) -> tuple[int, int, int]:
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = probe.format
            probe.verify()
        if fmt not in _ALLOWED_FORMATS:
            raise ValueError
        with Image.open(io.BytesIO(raw)) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.thumbnail((_MAX_SIDE, _MAX_SIDE))
            target.parent.mkdir(parents=True, exist_ok=True)
            img.save(target, "JPEG", quality=85, optimize=True)
            return img.width, img.height, target.stat().st_size
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=422, detail="La foto no es válida. Envíe una imagen JPG o PNG.")


async def save_image(upload: UploadFile) -> AttachmentMeta:
    settings = get_settings()
    limit = settings.max_upload_mb * 1024 * 1024
    raw = await upload.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(status_code=413, detail=f"La foto supera {settings.max_upload_mb} MB.")
    if not raw:
        raise HTTPException(status_code=422, detail="La foto está vacía.")
    now = utcnow()
    file_id = uuid.uuid4().hex
    relative = Path(f"{now:%Y}/{now:%m}/{file_id}.jpg")
    width, height, size = await asyncio.to_thread(_process, raw, Path(settings.upload_dir) / relative)
    return AttachmentMeta(id=file_id, path=relative.as_posix(), size=size, width=width, height=height)


def attachment_path(meta: AttachmentMeta) -> Path:
    base = Path(get_settings().upload_dir).resolve()
    path = (base / meta.path).resolve()
    if base not in path.parents:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return path


def stored_image_path(relative_path: str) -> Path:
    base = Path(get_settings().upload_dir).resolve()
    path = (base / relative_path).resolve()
    if base not in path.parents:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return path
