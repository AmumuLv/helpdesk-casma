const CACHE_NAME = "helpdesk-casma-v3";
const OFFLINE_DB = "helpdesk-casma-offline";
const OFFLINE_STORE = "ticket-queue";
const SYNC_TAG = "helpdesk-ticket-sync";

const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
      self.clients.claim(),
    ])
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueTicket(request) {
  const clone = request.clone();
  const form = await clone.formData();
  const entries = [];
  for (const [name, value] of form.entries()) {
    if (value instanceof File) {
      entries.push({
        name,
        kind: "file",
        value,
        filename: value.name,
        contentType: value.type,
      });
    } else {
      entries.push({ name, kind: "text", value: String(value) });
    }
  }

  const item = {
    id: crypto.randomUUID(),
    url: clone.url,
    method: clone.method,
    createdAt: Date.now(),
    entries,
  };

  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  if (self.registration.sync) {
    try {
      await self.registration.sync.register(SYNC_TAG);
    } catch {
      // El evento "online" y los mensajes del cliente sirven como respaldo.
    }
  }
  return item.id;
}

async function getQueuedTickets() {
  const db = await openDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readonly");
    const request = tx.objectStore(OFFLINE_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

async function deleteQueuedTicket(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function flushTicketQueue() {
  const queued = await getQueuedTickets();
  for (const item of queued) {
    const form = new FormData();
    for (const entry of item.entries) {
      if (entry.kind === "file") {
        form.append(entry.name, entry.value, entry.filename || "foto.jpg");
      } else {
        form.append(entry.name, entry.value);
      }
    }

    try {
      const response = await fetch(item.url, {
        method: item.method,
        body: form,
        credentials: "include",
        headers: { "X-Requested-With": "HelpDeskCasma" },
      });

      if (response.ok) {
        const payload = await response.clone().json().catch(() => null);
        await deleteQueuedTicket(item.id);
        await notifyClients({ type: "OFFLINE_TICKET_SENT", queueId: item.id, payload });
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await notifyClients({ type: "OFFLINE_TICKET_AUTH_REQUIRED", queueId: item.id });
        break;
      }

      // Errores de validación no se reintentan indefinidamente.
      if (response.status >= 400 && response.status < 500) {
        const payload = await response.clone().json().catch(() => null);
        await deleteQueuedTicket(item.id);
        await notifyClients({ type: "OFFLINE_TICKET_REJECTED", queueId: item.id, payload });
      }
    } catch {
      // Sigue sin conexión: se conserva la cola para el siguiente intento.
      break;
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushTicketQueue());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "FLUSH_OFFLINE_TICKETS") {
    event.waitUntil(flushTicketQueue());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method === "POST"
    && url.origin === self.location.origin
    && url.pathname === "/api/office/tickets"
  ) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        const queueId = await queueTicket(request);
        return new Response(
          JSON.stringify({ offline_queued: true, queue_id: queueId }),
          { status: 202, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // No guardar respuestas API autenticadas en caché.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
