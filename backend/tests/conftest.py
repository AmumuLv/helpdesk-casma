import os
import uuid

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("MONGO_URI", "mongodb://127.0.0.1:27017")
os.environ["MONGO_DB"] = f"helpdesk_test_{uuid.uuid4().hex[:8]}"
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ["ENVIRONMENT"] = "test"
os.environ["COOKIE_SECURE"] = "false"
os.environ["RUN_SCHEDULER"] = "false"
os.environ["OFFICE_ALLOWED_NETWORKS"] = ""
os.environ["UPLOAD_DIR"] = f"/tmp/hd-test/{os.environ['MONGO_DB']}/uploads"
os.environ["MODEL_DIR"] = f"/tmp/hd-test/{os.environ['MONGO_DB']}/models"

from app.main import app  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402

limiter.enabled = False
HEADERS = {"X-Requested-With": "HelpDeskCasma"}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def lifespan():
    async with app.router.lifespan_context(app):
        yield
        from app.db import database

        await database().client.drop_database(os.environ["MONGO_DB"])


@pytest_asyncio.fixture(loop_scope="session")
async def client(lifespan):
    async with AsyncClient(transport=ASGITransport(app=app, client=("127.0.0.1", 5000)), base_url="http://test/api", headers=HEADERS) as c:
        yield c


@pytest.fixture
def anyio_backend():
    return "asyncio"
