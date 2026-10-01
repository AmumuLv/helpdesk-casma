"""Contrato público de la API: una sola ruta por operación y esquemas coherentes.

No necesita MongoDB: solo inspecciona el esquema OpenAPI generado por FastAPI.
"""

from app.main import app

PATHS = app.openapi()["paths"]


def test_registro_asistido_tiene_una_sola_ruta_post():
    """POST /api/tickets debe declararse una sola vez (registro asistido por TI)."""
    assert PATHS["/api/tickets"]["post"]["operationId"] == "create_assisted_ticket_api_tickets_post"


def test_contrato_de_registro_asistido():
    cuerpo = PATHS["/api/tickets"]["post"]
    assert cuerpo["responses"]["201"]["content"]["application/json"]["schema"]["$ref"].endswith("TicketOut")
    ref = cuerpo["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    assert ref == "#/components/schemas/Body_create_assisted_ticket_api_tickets_post"
    campos = app.openapi()["components"]["schemas"][ref.rsplit("/", 1)[1]]["properties"]
    # Campos que usa el formulario de registro asistido del panel TI.
    for campo in ("office_id", "description", "channel", "municipal_user_id", "reporter_name",
                  "contact_phone", "equipment_id", "technician_id", "category", "priority"):
        assert campo in campos, f"El contrato de registro no expone {campo}"


def test_adjuntos_de_incidencia_usan_la_misma_ruta_que_el_serializer():
    """El serializer publica /attachments/{id}; la ruta de descarga debe coincidir."""
    assert "/api/tickets/{ticket_id}/attachments/{attachment_id}" in PATHS
    assert "get" in PATHS["/api/tickets/{ticket_id}/attachments/{attachment_id}"]


def test_rutas_de_atencion_existentes():
    esperadas = [
        "/api/tickets/{ticket_id}/resolve",
        "/api/tickets/{ticket_id}/reopen",
        "/api/tickets/{ticket_id}/reassign",
        "/api/tickets/{ticket_id}/wait",
        "/api/tickets/{ticket_id}/resume",
        "/api/tickets/{ticket_id}/notes",
        "/api/tickets/{ticket_id}/reanalyze",
        "/api/tickets/{ticket_id}/conversation",
        "/api/tickets/{ticket_id}/conversation/messages",
        "/api/office/tickets",
    ]
    faltantes = [ruta for ruta in esperadas if ruta not in PATHS]
    assert not faltantes, f"Rutas de atención ausentes: {faltantes}"