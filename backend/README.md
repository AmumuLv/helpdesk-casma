# Backend

FastAPI + MongoDB (Beanie) + scikit-learn. Ver el README principal para el despliegue completo.

## Comandos

```bash
uvicorn app.main:app --reload                 # servidor de desarrollo
pytest                                        # pruebas (necesita MongoDB en MONGO_URI)
python -m app.cli create-admin --username X --full-name "Y"
python -m app.cli set-office-password
python -m app.cli train-ai
python -m app.cli check-db                    # diagnóstico de la conexión a MongoDB
python -m app.cli seed-demo                   # datos de demostración
python -m scripts.migrate_legacy --legacy-uri "..." --legacy-db helpdesk_db
```

## Variables de entorno

Ver `.env.example`. Las obligatorias son `MONGO_URI`, `JWT_SECRET` y `FIELD_ENCRYPTION_KEY`.

Para usar embeddings de deep learning en lugar de TF-IDF:

```bash
pip install -r requirements-dl.txt
# y en .env:
AI_EMBEDDINGS=sentence-transformers
```

Consume alrededor de 1 GB más de memoria y la primera carga descarga el modelo.

## Documentación de la API

Con `ENVIRONMENT=development`, la documentación interactiva queda en `/api/docs`.

### Contrato de registro de incidencias

El registro por parte de TI tiene una sola ruta: `POST /api/tickets`, declarada en
`app/api/staff_ticket_entry.py` (`create_assisted_ticket`). Acepta `multipart/form-data` con:

| Campo | Obligatorio | Descripción |
| --- | --- | --- |
| `office_id` | sí | Oficina donde se origina la incidencia. |
| `description` | sí | Descripción del problema (3 a 2000 caracteres). |
| `channel` | no | `TELEFONO` (por defecto), `PRESENCIAL` o `INTERNO`. |
| `municipal_user_id` | no | Persona registrada de esa oficina; completa nombre y teléfono. |
| `reporter_name` | condicional | Nombre de quien reporta; obligatorio si no se usa `municipal_user_id`. |
| `contact_phone` | no | 9 dígitos; si se omite se toma el del usuario seleccionado. |
| `equipment_id` | no | Equipo de la oficina. |
| `category`, `priority`, `technician_id`, `subject`, `quick_issue`, `photo` | no | Gestión de la incidencia y evidencia. |

`app/api/tickets.py` no declara otra ruta `POST ""`: el resto de operaciones sobre incidencias
(listar, detalle, notas, asignación, espera, resolución, reapertura, reanálisis, adjuntos)
permanece en ese módulo.
