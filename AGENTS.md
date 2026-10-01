# AGENTS.md — Reglas para trabajar en este repositorio

Este proyecto es el sistema de incidencias del Área de Informática y TI de la
Municipalidad Provincial de Casma. Python/FastAPI + MongoDB/Beanie en `backend/`,
React + TypeScript + Vite + Tailwind en `frontend/`.

## Antes de tocar código

1. Lee `docs/PLAN_MPC.md`. Contiene la rama activa, la etapa en curso, las decisiones
   ya tomadas y la siguiente tarea concreta. Si el registro difiere del código,
   corrige el registro con evidencia.
2. Lee de `Prompt_Maestro_Helpdesk_Casma.md` solo las secciones que la tarea necesita
   (1, 11, 12 y 13 aplican a todas las etapas).
3. Revisa el estado de Git y conserva los cambios locales. Trabaja en la rama de
   mejora; no publiques ni integres a `main` sin un encargo explícito.

## Cómo ejecutar una etapa

- Atiende la etapa solicitada y las dependencias necesarias para que funcione.
- Divide etapas grandes en tareas pequeñas en `docs/PLAN_MPC.md` y complétalas en orden.
- Lee los archivos que vas a modificar y los contratos relacionados antes de editarlos.
- Unifica contratos y servicios existentes en lugar de duplicarlos; una ruta de API
  por operación.
- Conserva datos, identificadores y trazabilidad. Las migraciones deben ser repetibles.
- Valida permisos en el servidor, también para adjuntos, fotos, descargas y SSE.
- Usa configuración local para secretos. Nunca subas `.env` ni claves.
- Cuando un error aparezca, investiga la causa antes de ampliar la tarea.
- Registra en `docs/PLAN_MPC.md` comandos, resultados y checks pendientes.
  Una prueba pendiente conserva ese estado.

## Comprobaciones mínimas

```bash
cd frontend && npm run build          # tsc -b + vite build, sin marcadores de conflicto
cd backend  && pytest -q              # requiere MongoDB en MONGO_URI
```

El backend usa una base de pruebas separada (conftest.py). Si `backend/.venv` no
instala dependencias por versión de Python, crea un entorno 3.11 con `uv`
(`uv venv --python 3.11 .venv311`) e instálalo con `uv pip install`.
Ese entorno está ignorado por Git.

## Reglas de entrega

- Cambios reales en archivos, revisables en la rama de la etapa.
- Actualiza `docs/PLAN_MPC.md` al cerrar cada tarea y deja escrita la siguiente.
- Cierra con un resumen breve: comportamiento corregido, archivos modificados,
  checks ejecutados y estado de la etapa.
- Distingue siempre: fallo reproducido, inconsistencia comprobada en código y
  riesgo pendiente de prueba.