const CACHE_NAME = "helpdesk-casma-v4";
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

async function countQueuedRequests() {
  const db = await openDb();
  const count = await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readonly");
    const request = tx.objectStore(OFFLINE_STORE).count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return count;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function notifyQueueChanged() {
  await notifyClients({ type: "OFFLINE_QUEUE_CHANGED", pending: await countQueuedRequests() });
}

async function serializeRequest(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.clone().formData();
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
    return { bodyType: "form", entries };
  }

  if (contentType.includes("application/json")) {
    return { bodyType: "json", text: await request.clone().text() };
  }

  return { bodyType: "text", text: await request.clone().text(), contentType };
}

async function queueRequest(request, scope, operationId) {
  const serialized = await serializeRequest(request);
  const item = {
    id: operationId,
    url: request.url,
    method: request.method,
    scope,
    createdAt: Date.now(),
    ...serialized,
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
      // El evento online y los mensajes del cliente sirven como respaldo.
    }
  }

  await notifyQueueChanged();
  return item.id;
}

async function getQueuedRequests() {
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

async function deleteQueuedRequest(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function restoreRequestBody(item) {
  const headers = {
    "X-Requested-With": "HelpDeskCasma",
    "X-Offline-Replay": "1",
    "X-Offline-Operation": item.id,
  };

  if (item.bodyType === "form") {
    const form = new FormData();
    for (const entry of item.entries || []) {
      if (entry.kind === "file") {
        form.append(entry.name, entry.value, entry.filename || "foto.jpg");
      } else {
        form.append(entry.name, entry.value);
      }
    }
    return { body: form, headers };
  }

  if (item.bodyType === "json") {
    headers["Content-Type"] = "application/json";
    return { body: item.text || "{}", headers };
  }

  if (item.contentType) headers["Content-Type"] = item.contentType;
  return { body: item.text || undefined, headers };
}

async function flushTicketQueue() {
  const queued = await getQueuedRequests();

  for (const item of queued) {
    const { body, headers } = restoreRequestBody(item);

    try {
      const response = await fetch(item.url, {
        method: item.method,
        body,
        credentials: "include",
        headers,
      });

      if (response.ok) {
        const payload = await response.clone().json().catch(() => null);
        await deleteQueuedRequest(item.id);
        await notifyClients({
          type: "OFFLINE_REQUEST_SENT",
          queueId: item.id,
          scope: item.scope,
          payload,
        });
        await notifyQueueChanged();
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        await notifyClients({
          type: "OFFLINE_REQUEST_AUTH_REQUIRED",
          queueId: item.id,
          scope: item.scope,
        });
        break;
      }

      if (response.status >= 400 && response.status < 500) {
        const payload = await response.clone().json().catch(() => null);
        await deleteQueuedRequest(item.id);
        await notifyClients({
          type: "OFFLINE_REQUEST_REJECTED",
          queueId: item.id,
          scope: item.scope,
          payload,
        });
        await notifyQueueChanged();
      }
    } catch {
      break;
    }
  }
}

function isOfficeTicketCreate(request, url) {
  return request.method === "POST" && url.pathname === "/api/office/tickets";
}

function isStaffTicketMutation(request, url) {
  if (!url.pathname.startsWith("/api/tickets")) return false;

  if (request.method === "POST" && url.pathname === "/api/tickets") return true;
  if (request.method === "PATCH" && /^\/api\/tickets\/[^/]+$/.test(url.pathname)) return true;
  if (
    request.method === "POST"
    && /^\/api\/tickets\/[^/]+\/(assign|notes|resolve|reopen|apply-ai-priority)$/.test(url.pathname)
  ) return true;

  return false;
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushTicketQueue());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "FLUSH_OFFLINE_TICKETS") {
    event.waitUntil(flushTicketQueue());
  }
  if (event.data?.type === "GET_OFFLINE_QUEUE_COUNT") {
    event.waitUntil(
      countQueuedRequests().then((pending) => {
        event.source?.postMessage({ type: "OFFLINE_QUEUE_CHANGED", pending });
      })
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    url.origin === self.location.origin
    && (isOfficeTicketCreate(request, url) || isStaffTicketMutation(request, url))
  ) {
    const scope = isOfficeTicketCreate(request, url) ? "office" : "staff";
    const operationId = crypto.randomUUID();
    event.respondWith((async () => {
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.set("X-Offline-Operation", operationId);
      try {
        return await fetch(new Request(request.clone(), { headers: forwardedHeaders }));
      } catch {
        const queueId = await queueRequest(request, scope, operationId);
        return new Response(
          JSON.stringify({ offline_queued: true, queue_id: queueId, scope }),
          { status: 202, headers: { "Content-Type": "application/json" } }
        );
      }
    })());
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

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
