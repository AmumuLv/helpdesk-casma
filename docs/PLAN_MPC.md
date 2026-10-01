# PLAN_MPC — Plan de trabajo del Helpdesk de la Municipalidad Provincial de Casma

Especificación de referencia: `Prompt_Maestro_Helpdesk_Casma.md` (raíz del repositorio).
Este archivo es el registro de avance: se actualiza al cerrar cada tarea.

## Rama y base

- Rama de trabajo: `etapa-1-estabilizacion`
- Commit base: `1207114` (`main`, "Cambio del fronted")
- Cambios de la etapa 1 quedan en esta rama para revisión. No se publica ni se integra a `main` sin encargo posterior.

## Etapa activa

- Etapa 1 — Estabilización (en curso).
- Tarea actual: revisión del diff y cierre de comprobaciones.

## Decisiones tomadas

- **Identidad**: se conserva el modelo vigente. `StaffUser` = personal TI con credenciales; `MunicipalUser` = ficha municipal sin credenciales. La unificación de identidades en una cuenta personal por persona corresponde a la etapa 3; en la etapa 1 no se altera ese modelo.
- **Jerarquía**: Zona → Oficina → Usuario ya es validada en servidor en el registro asistido (`_municipal_user_for`, `_equipment_for`). La ampliación (dirección de zona, jefaturas con periodos, perfiles agregados) corresponde a la etapa 2.
- **Registro de incidencias**: un único contrato en `POST /api/tickets`, declarado en `app/api/staff_ticket_entry.py`. `app/api/tickets.py` ya no declara un segundo `POST ""`.
- **Adjuntos de incidencia**: la ruta de descarga coincide con la URL que publica `serializers._attachments` (`/api/tickets/{id}/attachments/{attachment_id}`).
- **Reentrenamiento**: no se fuerza en cada cierre ni en cada reanálisis. El cierre usa el umbral existente (`services/tickets._maybe_retrain`); el reanálisis recalcula el análisis del ticket sin entrenar.
- **Estados**: sin cambios en esta etapa. `PENDIENTE / EN_PROCESO / RESUELTO` más los estados de atención del chat permanecen como están.

## Tareas de la etapa 1

| Tarea | Estado | Evidencia |
| --- | --- | --- |
| Resolver conflictos de `TicketConversation.tsx` | verificada | `npm run build` sin marcadores |
| Unificar `POST /api/tickets` | verificada | `tests/test_api_contract.py` |
| Alinear contrato de adjuntos de incidencia | verificada | prueba de integración descarga el adjunto (200) |
| Reparar `/tickets/triage-preview` faltante | verificada | `test_full_flow` |
| Reparar `POST /{id}/resolve` y `/reanalyze` | verificada | `test_full_flow` |
| Alinear `tests/test_flow.py` con el contrato vigente | verificada | `pytest` 8 pruebas |
| Documentar el contrato en `backend/README.md` | verificada | tabla de campos |
| Migraciones necesarias | no aplica | sin cambios de datos ni de modelos en esta etapa |

## Archivos modificados

- `frontend/src/features/shared/TicketConversation.tsx`: se conservan los ocho bloques de conflictos, se adopta la variante del commit `986d860` (clases `panel`, `notice`, `size-4.5`, `text-tinta-2` coherentes con `styles.css` actual) y se mantienen las funciones de ambas variantes: badge de atención para TI y para oficina, aviso de registro asistido con icono `Phone`, envío simple y "enviar y esperar respuesta", adjuntos, errores de envío en ambos lados y lectura automática de no leídos.
- `backend/app/api/tickets.py`: se elimina la declaración duplicada `POST ""` y sus importaciones sin uso; se restaura `POST /triage-preview`; `POST /{id}/resolve` deja de invocar `engine.retrain` (método inexistente) y delega en `_maybe_retrain`; `POST /{id}/reanalyze` usa `analyze_ticket_background`; la ruta de adjuntos pasa a `/{ticket_id}/attachments/{attachment_id}` y usa `attachment_path(meta)`.
- `backend/tests/test_flow.py`: el equipo de prueba usa el tipo vigente `CPU` (antes `PC`, ya no admitido para altas) y declara `responsible_type: "OFICINA"`.
- `backend/tests/test_api_contract.py` (nuevo): verifica que exista una sola declaración `POST /api/tickets`, sus campos de formulario, la ruta de adjuntos y la presencia de las rutas de atención.
- `backend/README.md`: documenta el contrato único de registro.
- `backend/.gitignore`: ignora cualquier `.venv*` local.

## Comprobaciones ejecutadas

| Comando | Resultado | Fecha |
| --- | --- | --- |
| `npm run build` (frontend) | OK, `✓ built in 6.78s`, sin marcadores de conflicto | 2026-10-01 |
| `.venv311\Scripts\python.exe -m pytest -q` | 8 passed | 2026-10-01 |
| `python -c "from app.main import app; app.openapi()"` | Sin advertencias de operación duplicada; `/api/tickets` expone `get` y `post` con `operationId=create_assisted_ticket_api_tickets_post` | 2026-10-01 |

Nota de entorno: el `backend/.venv` del repositorio usa Python 3.14 y no puede instalar `beanie==2.2.0` (requiere <3.14). Se creó `backend/.venv311` (Python 3.11, vía `uv`) solo para validar; está ignorado por Git. Las pruebas usan una base separada (`helpdesk_test_<uuid>` en `conftest.py`) contra MongoDB local, no la base de trabajo.

## Fallos reproducidos corregidos en esta etapa

1. Frontend no compilaba por marcadores de conflicto en `TicketConversation.tsx` (fallo confirmado por CI y reproducido localmente).
2. `POST /api/tickets/{id}/attachment/{attachment_id}` usaba `attachment.stored_name` y `attachment.original_name`, campos que no existen en `AttachmentMeta`; la URL pública era `/attachments/{id}`. La descarga devolvía 404/500.
3. `POST /api/tickets/{id}/resolve` llamaba a `AIEngine.retrain`, que no existe: 500 en cada cierre. `POST /{id}/reanalyze` llamaba a `AIEngine.analyze_ticket`, que tampoco existe.
4. `POST /api/tickets/triage-preview` no estaba declarado: el formulario de registro asistido recibía 405.
5. Dos declaraciones `POST /api/tickets` con esquemas distintos; la segunda quedaba sombreada según el orden de inclusión de routers.

## Dependencias y límites del entorno

- MongoDB local en `127.0.0.1:27017` disponible; las pruebas crean y eliminan su propia base en esa instancia.
- Docker tiene un stack activo (`helpdesk_backend`, `helpdesk_frontend`, `helpdesk_mongo` en el puerto 27018) que no se usó para validar: no refleja estos cambios hasta reconstruir la imagen.
- El CI del repositorio solo ejecuta el frontend (Node 22). No hay workflow de backend; las comprobaciones de Python son locales.

## Próxima tarea

Etapa 2 — Organización: dirección y perfil de sede en `Zone`, historial de jefaturas con periodos en `Office`, módulo de navegación Zona → Oficina → Usuario y códigos automáticos/manuales con reserva atómica reutilizando `next_sequence`. Antes, actualizar este registro con el resultado del cierre de la etapa 1.