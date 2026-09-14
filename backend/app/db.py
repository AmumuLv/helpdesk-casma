import re
from urllib.parse import urlsplit

from beanie import init_beanie
from pymongo import AsyncMongoClient, ReturnDocument
from pymongo.errors import ConfigurationError, OperationFailure, ServerSelectionTimeoutError

from app.core.config import get_settings
from app.models import DOCUMENT_MODELS

_client: AsyncMongoClient | None = None


def _safe_uri(uri: str) -> str:
    return re.sub(r"://([^:/@]+):[^@]*@", r"://\1:***@", uri)


def _hint(uri: str, error: Exception) -> str:
    host = urlsplit(uri).hostname or "?"
    if isinstance(error, OperationFailure):
        return (f"MongoDB rechazó las credenciales en {host}. Si es el contenedor local y cambió MONGO_PASSWORD "
                f"después del primer arranque, el usuario quedó creado con la clave anterior: "
                f"'docker compose down -v' borra el volumen y lo vuelve a crear. "
                f"Si la contraseña tiene @ : / # o ?, debe ir codificada en la URI.")
    if isinstance(error, ConfigurationError):
        return (f"No se pudo resolver {host}. Con Atlas (mongodb+srv://) hace falta 'pymongo[srv]' instalado "
                f"y salida DNS desde el contenedor.")
    if host in ("localhost", "127.0.0.1"):
        return ("No hay MongoDB escuchando en este contenedor. Dentro de Docker el host es el nombre del servicio "
                "('mongo'), no 'localhost'.")
    return (f"No se pudo contactar a {host}. Verifique que el servicio esté levantado, que ambos contenedores estén "
            f"en la misma red y, si usa Atlas, que la IP del servidor esté en la lista de acceso.")


async def connect() -> None:
    global _client
    settings = get_settings()
    _client = AsyncMongoClient(settings.mongo_uri, tz_aware=True, serverSelectionTimeoutMS=10000)
    try:
        await _client.admin.command("ping")
    except (ServerSelectionTimeoutError, OperationFailure, ConfigurationError) as error:
        raise RuntimeError(
            f"No se pudo conectar a MongoDB con {_safe_uri(settings.mongo_uri)}\n{_hint(settings.mongo_uri, error)}\nDetalle: {error}"
        ) from error
    await init_beanie(database=_client[settings.mongo_db], document_models=DOCUMENT_MODELS)


async def disconnect() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None


def database():
    if _client is None:
        raise RuntimeError("Base de datos no inicializada")
    return _client[get_settings().mongo_db]


async def next_sequence(name: str) -> int:
    doc = await database()["counters"].find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["seq"])
