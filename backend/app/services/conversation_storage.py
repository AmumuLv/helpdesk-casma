import asyncio
import io
import mimetypes
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models.conversation import ConversationAttachment

Image.MAX_IMAGE_PIXELS = 40_000_000
_MAX_SIDE = 1920
_ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "MPO"}


def _safe_name(value: str | None) -> str:
    name = Path(value or "archivo").name.strip() or "archivo"
    return name[:120]


def _process_image(raw: bytes, target: Path) -> tuple[int, int, int]:
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = probe.format
            probe.verify()
        if fmt not in _ALLOWED_IMAGE_FORMATS:
            raise ValueError
        with Image.open(io.BytesIO(raw)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail((_MAX_SIDE, _MAX_SIDE))
            target.parent.mkdir(parents=True, exist_ok=True)
            img.save(target, "JPEG", quality=85, optimize=True)
            return img.width, img.height, target.stat().st_size
    except (UnidentifiedImageError, ValueError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=422, detail="El archivo no es una imagen válida.")


async def save_conversation_attachment(upload: UploadFile) -> ConversationAttachment:
    settings = get_settings()
    limit = settings.max_upload_mb * 1024 * 1024
    raw = await upload.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(status_code=413, detail=f"El archivo supera {settings.max_upload_mb} MB.")
    if not raw:
        raise HTTPException(status_code=422, detail="El archivo está vacío.")

    original_name = _safe_name(upload.filename)
    declared = (upload.content_type or "").lower()
    guessed = (mimetypes.guess_type(original_name)[0] or "").lower()
    is_pdf = declared == "application/pdf" or guessed == "application/pdf" or original_name.lower().endswith(".pdf")
    now = utcnow()
    file_id = uuid.uuid4().hex

    if is_pdf:
        if not raw.startswith(b"%PDF-"):
            raise HTTPException(status_code=422, detail="El PDF no es válido.")
        relative = Path(f"chat/{now:%Y}/{now:%m}/{file_id}.pdf")
        target = Path(settings.upload_dir) / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(target.write_bytes, raw)
        return ConversationAttachment(
            id=file_id,
            path=relative.as_posix(),
            original_name=original_name,
            content_type="application/pdf",
            size=len(raw),
        )

    relative = Path(f"chat/{now:%Y}/{now:%m}/{file_id}.jpg")
    width, height, size = await asyncio.to_thread(_process_image, raw, Path(settings.upload_dir) / relative)
    return ConversationAttachment(
        id=file_id,
        path=relative.as_posix(),
        original_name=original_name,
        content_type="image/jpeg",
        size=size,
        width=width,
        height=height,
    )


def conversation_attachment_path(relative_path: str) -> Path:
    base = Path(get_settings().upload_dir).resolve()
    path = (base / relative_path).resolve()
    if base not in path.parents:
        raise HTTPException(status_code=404, detail="Archivo no encontrado.")
    return path
