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
