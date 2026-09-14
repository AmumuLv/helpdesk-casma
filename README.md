# Help Desk Municipal — Municipalidad Provincial de Casma

Sistema de gestión de incidencias de Soporte TI con dos caras:

- **Portal de oficina**: pantalla muy simple, pensada para personal que no maneja bien la computadora. Botones grandes, letra grande, foto con la cámara y dictado por voz.
- **Panel de Soporte TI**: tablero de incidencias, inventario de equipos, administración y análisis con IA.

Reemplaza al sistema anterior en Node/Express, conservando la estructura del tablero pero con arquitectura por componentes, autenticación real y modelos de aprendizaje automático propios.

---

## 1. Tecnologías

| Capa | Tecnología |
|---|---|
| Backend | Python 3.12, FastAPI, Beanie (ODM) |
| Base de datos | MongoDB |
| IA | scikit-learn (TF-IDF + regresión logística, gradient boosting), opcionalmente `sentence-transformers` |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4 |
| Tiempo real | Server-Sent Events |
| Despliegue | Docker Compose con nginx |

---

## 2. Puesta en marcha con Docker

```bash
cp .env.example .env
# Genere los secretos:
python3 -c "import secrets;print(secrets.token_urlsafe(48))"          # JWT_SECRET
python3 -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"  # FIELD_ENCRYPTION_KEY
# Complete también MONGO_PASSWORD y PUBLIC_BASE_URL (la IP o dominio del servidor)

docker compose up -d --build
```

El sistema queda en `http://<IP-del-servidor>:8080`.

### Configuración inicial (una sola vez)

```bash
# 1. Cree el administrador (pedirá la contraseña de forma interactiva)
docker compose exec backend python -m app.cli create-admin --username soporte.ti --full-name "Nombre Apellido"

# 2. Defina la contraseña común de las oficinas
docker compose exec backend python -m app.cli set-office-password

# 3. Entrene los modelos por primera vez
docker compose exec backend python -m app.cli train-ai
```

Luego entre a `http://<IP>:8080/soporte/ingresar`, inicie sesión y escanee el código QR con Google Authenticator o Microsoft Authenticator. Desde el panel cree las oficinas, registre los equipos y dé de alta a los técnicos.

### Importar los tickets del sistema anterior

```bash
docker compose exec backend python -m scripts.migrate_legacy \
  --legacy-uri "mongodb+srv://usuario:clave@cluster/..." --legacy-db helpdesk_db
```

Crea las oficinas a partir del campo `area` y las deja **inactivas** para que usted les asigne usuario y las revise antes de activarlas.

### Datos de demostración (solo para la presentación del proyecto)

```bash
docker compose exec backend python -m app.cli seed-demo
docker compose exec backend python -m app.cli train-ai
```

Crea 6 oficinas municipales, 30 equipos y unas 190 incidencias históricas para que los modelos y los gráficos tengan contenido. **No lo ejecute en producción.**

---

## 3. Desarrollo local sin Docker

```bash
# Backend
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # apunte MONGO_URI a su MongoDB
uvicorn app.main:app --reload

# Frontend (otra terminal)
cd frontend
npm install
npm run dev              # http://localhost:5173, con proxy a :8000
```

Pruebas del backend: `pytest` (necesita un MongoDB accesible en `MONGO_URI`).

---

## 4. Cómo funciona el acceso

### Oficinas (cuenta compartida)

Cada oficina tiene **su propio usuario** (`tesoreria`, `mesadepartes`, …) y **todas comparten la misma contraseña**, que el administrador cambia desde *Oficinas → Contraseña de oficinas*. La sesión dura 30 días, así que el personal casi nunca vuelve a escribirla.

Como la contraseña es común, la seguridad real se apoya en dos cercos:

1. **Autorización por dispositivo.** La primera vez que se usa una computadora o celular, la pantalla muestra un código de seis caracteres (por ejemplo `MW6-WCD`). El usuario lo dicta por teléfono a Soporte TI, que lo autoriza desde *Dispositivos*, le pone nombre y lo vincula con su código patrimonial. Hasta entonces no puede hacer nada.
2. **Restricción por red.** `OFFICE_ALLOWED_NETWORKS` limita el ingreso a las redes internas de la municipalidad.

Si mantiene ambos cercos activos, conocer la contraseña no alcanza para entrar. Si los desactiva, cualquiera que la conozca podría entrar adivinando un usuario evidente como `tesoreria`; en ese caso cámbiela con frecuencia.

Al cambiar la contraseña común se cierra la sesión en todos los equipos, pero **no** hace falta volver a autorizar los dispositivos.

### Personal de Soporte TI

Cuentas individuales, con reglas distintas y más estrictas:

- Contraseña de 12 caracteres como mínimo, con mayúsculas, minúsculas, números y símbolos, guardada con Argon2.
- **Verificación en dos pasos obligatoria** (TOTP); el secreto se guarda cifrado.
- Bloqueo tras 5 intentos fallidos y sesión corta de 9 horas.
- Al crear una cuenta se genera una contraseña temporal de un solo uso que el sistema obliga a cambiar.
- Solo el administrador gestiona oficinas, dispositivos, personal, auditoría y eliminación de incidencias.

---

## 5. La IA: qué hace y qué no

No es un chatbot. Son cinco modelos que trabajan sobre las incidencias reales de la municipalidad.

| Componente | Técnica | Para qué sirve |
|---|---|---|
| Clasificador de categoría | TF-IDF (palabras y caracteres) + regresión logística | Ordena la incidencia sin que el usuario elija categoría |
| Prioridad | Reglas explicables + modelo aprendido de las prioridades validadas | Sube a urgente si menciona caja, SIAF, público esperando, toda la oficina… |
| Mantenimiento predictivo | Gradient boosting con validación temporal, con modelo experto de respaldo | Ranking de equipos con mayor riesgo de fallar en 30 días |
| Casos parecidos | Similitud del coseno sobre incidencias resueltas | Muestra al técnico cómo se solucionó algo igual antes |
| Fallas masivas | Prueba de Poisson sobre la frecuencia por categoría y ubicación | Detecta "se cayó el internet del piso 1" y avisa a técnicos y oficinas |

Además sugiere el técnico según especialidad, historial en casos similares y carga actual.

**Cómo aprende.** Cada vez que un técnico corrige la categoría o la prioridad en el detalle de una incidencia, esa corrección pesa el triple en el siguiente entrenamiento. El reentrenamiento corre solo cada 25 incidencias resueltas y de madrugada (02:30).

**Sobre las métricas.** En *Análisis IA* verá un F1 del clasificador cercano al 100 %. Esa cifra es optimista: se mide sobre el mismo corpus con el que se entrena, que incluye frases semilla escritas a propósito. La medida honesta de calidad es cuántas veces el técnico tiene que corregir la categoría en el uso diario. El modelo de riesgo sí usa validación temporal: si no alcanza un AUC de 0.65, el sistema lo descarta y usa el modelo experto, y lo indica en pantalla.

---

## 6. Etiquetas QR

Desde *Equipos → un equipo → Imprimir etiqueta* se genera una etiqueta con el código QR del equipo. Al escanearla con el celular se abre el formulario de reporte con ese equipo ya seleccionado. Requiere que `PUBLIC_BASE_URL` apunte a la dirección real del servidor.

---

## 7. Si falla la conexión con MongoDB

Primero pregúntele al propio sistema:

```bash
docker compose exec backend python -m app.cli check-db
```

Si conecta, imprime la versión del servidor y la cantidad de colecciones. Si no, dice el motivo probable. Para ver el error de arranque completo: `docker compose logs backend`.

Causas más frecuentes, en orden:

| Síntoma | Causa | Solución |
|---|---|---|
| `Authentication failed` con el contenedor local | Cambió `MONGO_PASSWORD` después del primer arranque. Mongo crea el usuario solo la primera vez y el volumen conservó la clave anterior | `docker compose down -v && docker compose up -d` (borra los datos) o cambie la clave dentro de Mongo |
| `Authentication failed` y la contraseña tiene `@ : / # ?` | Esos caracteres parten la URI | Use solo letras y números, o codifíquelos (`@` es `%40`) |
| `Name or service not known: mongo` | Está ejecutando el backend fuera de Docker con la URI del contenedor | Fuera de Docker use `mongodb://localhost:27017`; el nombre `mongo` solo existe dentro de la red de Compose |
| `Connection refused` en `localhost` desde el contenedor | `localhost` dentro del contenedor es el contenedor mismo | El host correcto es `mongo` |
| Falla con `mongodb+srv://` (Atlas) | Faltaba `pymongo[srv]`, o el contenedor no resuelve DNS, o la IP del servidor no está en la lista de acceso de Atlas | Reconstruya con `docker compose build --no-cache backend` y agregue la IP pública del servidor en *Network Access* de Atlas |
| `MONGO_PASSWORD variable is not set` al hacer `up` | Falta el archivo `.env` junto a `docker-compose.yml` | `cp .env.example .env` y complételo |

### Usar MongoDB Atlas en lugar del contenedor

Defina `MONGO_URI` en `.env` y esa cadena tiene prioridad:

```
MONGO_URI=mongodb+srv://usuario:clave@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Luego levante solo lo necesario: `docker compose up -d backend web`. Atlas exige que la IP pública del servidor esté autorizada en *Network Access*.

### Inspeccionar la base a mano

```bash
docker compose exec mongo mongosh -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin
```

Para conectarse con Compass desde el servidor, descomente el bloque `ports` del servicio `mongo` en `docker-compose.yml`.

---

## 8. Mantenimiento

**Respaldos.** Dos cosas que respaldar: la base de datos y el volumen `backend-data` (fotos adjuntas y modelos entrenados).

```bash
docker compose exec mongo mongodump --archive=/tmp/hd.gz --gzip \
  -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin
docker compose cp mongo:/tmp/hd.gz ./respaldo-$(date +%F).gz
docker run --rm -v helpdesk-casma_backend-data:/data -v "$PWD":/out alpine \
  tar czf /out/archivos-$(date +%F).tar.gz -C /data .
```

**Registro de auditoría.** *Auditoría* muestra accesos, intentos fallidos y acciones administrativas, con la IP de origen.

**Antes de exponerlo fuera de la red interna.** Ponga un certificado HTTPS delante (por ejemplo con Caddy o nginx en el servidor) y cambie `COOKIE_SECURE=true`. Sin HTTPS, las cookies de sesión viajan sin cifrar.

---

## 9. Estructura del proyecto

```
backend/
  app/
    api/          rutas HTTP (auth, portal de oficina, incidencias, equipos, admin, IA, eventos)
    ai/           motor de IA: clasificación, prioridad, riesgo, similitud, anomalías
    core/         configuración, seguridad, red, límites de peticiones
    models/       documentos de MongoDB
    services/     lógica de incidencias, dispositivos, almacenamiento, auditoría
    cli.py        create-admin, set-office-password, train-ai, seed-demo
  scripts/        migración del sistema anterior
  tests/          pruebas de extremo a extremo con pytest
frontend/
  src/
    components/   UI compartida (botones, campos, modales, cámara, voz)
    features/
      auth/       ingreso de oficina, espera de autorización, ingreso de personal con 2FA
      office/     portal simple de la oficina
      staff/      tablero, detalle, equipos, dispositivos, oficinas, personal, IA, auditoría
    lib/          cliente HTTP, tipos, etiquetas en español, sesión y eventos
docker-compose.yml
```

---

## 10. Sobre el sistema anterior

El proyecto que entregó contenía el archivo `.env` con la cadena de conexión a MongoDB Atlas, usuario y contraseña incluidos. **Cambie esa contraseña en Atlas**: cualquiera que tenga ese archivo puede leer y borrar los datos.

Otros problemas del sistema anterior, ya resueltos aquí: ninguna ruta de la API pedía autenticación, el rol se guardaba en `localStorage` y se podía editar desde el navegador, la contraseña del administrador estaba escrita en `server.js`, los textos de los usuarios se insertaban con `innerHTML` (permitía inyectar código) y se aceptaba cualquier archivo como foto.
