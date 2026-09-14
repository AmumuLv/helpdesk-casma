import io

import pyotp
import pytest
from PIL import Image

from app.core.security import hash_password
from app.models import StaffUser
from app.models.enums import StaffRole, TicketCategory
from app.services.office_access import set_office_password
from tests.conftest import HEADERS

pytestmark = pytest.mark.asyncio(loop_scope="session")
ADMIN_PW = "Soporte#Casma-2026x"


async def _staff_login(client, username, password, secret=None):
    r = await client.post("/auth/staff/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    token = r.json()["mfa_token"]
    if r.json()["mfa_setup_required"]:
        r = await client.post("/auth/staff/mfa/setup", json={"mfa_token": token})
        assert r.status_code == 200, r.text
        secret = r.json()["secret"]
        assert r.json()["qr_data_uri"].startswith("data:image/png")
    r = await client.post("/auth/staff/mfa/verify", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()})
    assert r.status_code == 200, r.text
    return secret


async def test_full_flow(client):
    assert (await client.get("/health")).status_code == 200
    assert (await client.post("/auth/logout", headers={"X-Requested-With": ""})).status_code == 403

    await StaffUser(username="admin.ti", full_name="Admin TI", role=StaffRole.ADMIN, password_hash=hash_password(ADMIN_PW),
                    specialties=[TicketCategory.RED_INTERNET]).insert()
    await set_office_password("OficinasCasma2026")

    r = await client.post("/auth/staff/login", json={"username": "admin.ti", "password": "mala"})
    assert r.status_code == 401
    await _staff_login(client, "admin.ti", ADMIN_PW)
    me = (await client.get("/auth/me")).json()
    assert me["kind"] == "staff" and me["staff"]["role"] == "ADMIN"

    r = await client.post("/admin/offices", json={"code": "adm", "name": "Gerencia de Administración", "username": "administracion",
                                                   "location": "Piso 2", "head_name": "José Ramírez"})
    assert r.status_code == 201, r.text
    office = r.json()
    r = await client.post("/equipment", json={"patrimonial_code": "740880370001", "type": "PC", "brand": "HP", "model": "ProDesk 400 G6",
                                              "ip_address": "10.10.2.45", "office_id": office["id"]})
    assert r.status_code == 201, r.text
    equipment = r.json()

    r = await client.post("/admin/staff", json={"username": "cruiz", "full_name": "Carlos Ruiz", "role": "TECNICO", "specialties": ["HARDWARE"]})
    assert r.status_code == 201
    tech_id, tech_pw = r.json()["staff"]["id"], r.json()["temporary_password"]

    staff_cookies = dict(client.cookies)
    client.cookies.clear()

    r = await client.post("/auth/office/login", json={"username": "administracion", "password": "incorrecta1"})
    assert r.status_code == 401
    r = await client.post("/auth/office/login", json={"username": "ADMINISTRACION", "password": "OficinasCasma2026"})
    assert r.status_code == 200 and r.json()["status"] == "PENDIENTE", r.text
    assert (await client.get("/office/home")).status_code == 403
    me = (await client.get("/auth/me")).json()
    device_id = me["office"]["device_id"]
    office_cookies = dict(client.cookies)

    client.cookies.clear()
    client.cookies.update(staff_cookies)
    pending = (await client.get("/admin/devices", params={"status": "PENDIENTE"})).json()
    assert pending[0]["pair_code"] == me["office"]["pair_code"]
    r = await client.post(f"/admin/devices/{device_id}/approve", json={"kind": "PC", "label": "PC de José", "equipment_id": equipment["id"]})
    assert r.status_code == 200, r.text

    client.cookies.clear()
    client.cookies.update(office_cookies)
    home = (await client.get("/office/home")).json()
    assert home["this_equipment"]["patrimonial_code"] == "740880370001"

    buf = io.BytesIO()
    Image.new("RGB", (64, 48), "red").save(buf, "PNG")
    r = await client.post("/office/tickets", data={"quick_issue": "NO_ENCIENDE", "description": "sale olor a quemado y no prende", "reporter_name": "Doña Marta"},
                          files={"photo": ("foto.png", buf.getvalue(), "image/png")})
    assert r.status_code == 201, r.text
    created = r.json()
    assert not created["duplicated"] and created["ticket"]["attachments"]
    ticket_id = created["ticket"]["id"]
    assert (await client.get(created["ticket"]["attachments"][0]["url"].removeprefix("/api"))).status_code == 200

    r = await client.post("/office/tickets", data={"quick_issue": "NO_ENCIENDE", "description": "sigue sin prender"})
    assert r.json()["duplicated"] is True and r.json()["ticket"]["id"] == ticket_id

    r = await client.post("/office/tickets", data={"quick_issue": "SIN_INTERNET"}, files={"photo": ("x.png", b"not-an-image", "image/png")})
    assert r.status_code == 422

    client.cookies.clear()
    client.cookies.update(staff_cookies)
    ticket = (await client.get(f"/tickets/{ticket_id}")).json()
    assert ticket["ai"]["category"] == "HARDWARE"
    assert ticket["ai"]["briefing"]
    assert ticket["priority"] in ("MEDIA", "ALTA")
    kpis = (await client.get("/tickets/kpis")).json()
    assert kpis["total"] == 1 and kpis["pendientes"] == 1

    assert (await client.post(f"/tickets/{ticket_id}/assign", json={"technician_id": tech_id})).json()["status"] == "EN_PROCESO"
    r = await client.post(f"/tickets/{ticket_id}/resolve", json={"notes": "Se reemplazó la fuente de poder."})
    assert r.json()["status"] == "RESUELTO"
    page = (await client.get("/tickets", params={"q": "740880370001"})).json()
    assert page["total"] == 1

    preview = await client.post("/tickets/triage-preview", json={"office_id": office["id"], "description": "la impresora atasca el papel"})
    assert preview.json()["category"] == "IMPRESORA"

    client.cookies.clear()
    client.cookies.update(office_cookies)
    r = await client.post(f"/office/tickets/{ticket_id}/confirm", json={"solved": False})
    assert r.json()["status"] == "EN_PROCESO"
    assert all("IA" not in t["actor"] for t in r.json()["timeline"])

    client.cookies.clear()
    client.cookies.update(staff_cookies)
    assert (await client.put("/admin/settings/office-password", json={"new_password": "NuevaClave2027"})).status_code == 200
    r = await client.post("/ai/retrain")
    assert r.status_code == 200 and r.json()["metrics"]["category"]["f1_macro_cv"] > 0.7
    insights = (await client.get("/ai/insights")).json()
    assert insights["equipment_risk"][0]["patrimonial_code"] == "740880370001"
    assert (await client.get(f"/equipment/{equipment['id']}/qr")).headers["content-type"] == "image/png"

    client.cookies.clear()
    client.cookies.update(office_cookies)
    assert (await client.get("/office/home")).status_code == 401

    client.cookies.clear()
    r = await client.post("/auth/staff/login", json={"username": "cruiz", "password": tech_pw})
    token = r.json()["mfa_token"]
    secret = (await client.post("/auth/staff/mfa/setup", json={"mfa_token": token})).json()["secret"]
    await client.post("/auth/staff/mfa/verify", json={"mfa_token": token, "code": pyotp.TOTP(secret).now()})
    r = await client.get("/tickets")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    r = await client.post("/auth/staff/password", json={"current_password": tech_pw, "new_password": "Tecnico#Redes-2026"})
    assert r.status_code == 200, r.text
    assert (await client.get("/tickets")).status_code == 200
    assert (await client.get("/admin/staff")).status_code == 403
