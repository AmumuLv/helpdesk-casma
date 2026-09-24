const CACHE_NAME = "helpdesk-casma-v5";
const PRIVATE_READ_CACHE = "helpdesk-casma-private-v1";
const OFFLINE_DB = "helpdesk-casma-offline";
const OFFLINE_STORE = "ticket-queue";
const SYNC_TAG = "helpdesk-ticket-sync";

const AUTH_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DATA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WARM_THROTTLE_MS = 60 * 1000;
const TICKET_SNAPSHOT_URL = "/api/__offline/tickets-snapshot";

const APP_SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

const CORE_PRIVATE_URLS = [
  "/api/auth/me",
  "/api/tickets/kpis",
  "/api/equipment",
  "/api/lookup/offices",
  "/api/organization/zones",
  "/api/organization/users",
  "/api/technicians",
  "/api/ai/insights",
  "/api/admin/offices",
];

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
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== PRIVATE_READ_CACHE)
            .map((key) => caches.delete(key))
        )
      ),
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
  let sentStaffMutation = false;

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
        if (item.scope === "staff") sentStaffMutation = true;
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

  if (sentStaffMutation) {
    await warmPrivateData(true).catch(() => undefined);
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

function isPrivateReadableGet(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;

  const path = url.pathname;
  return (
    path === "/api/auth/me"
    || path === "/api/technicians"
    || path === "/api/lookup/offices"
    || path === "/api/ai/insights"
    || path === "/api/admin/offices"
    || path.startsWith("/api/tickets")
    || path.startsWith("/api/equipment")
    || path.startsWith("/api/organization/")
  );
}

async function clearPrivateReadCache() {
  await caches.delete(PRIVATE_READ_CACHE);
  await notifyClients({ type: "OFFLINE_READ_CACHE_CLEARED" });
}

async function responseWithCacheMetadata(response, cachedAt = Date.now()) {
  const headers = new Headers(response.headers);
  headers.set("X-Helpdesk-Cached-At", String(cachedAt));
  const body = await response.clone().arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function storePrivateResponse(request, response) {
  if (!response.ok) return;
  const cache = await caches.open(PRIVATE_READ_CACHE);
  const stored = await responseWithCacheMetadata(response);
  await cache.put(request, stored);
}

async function storePrivateJson(url, data, cachedAt = Date.now()) {
  const cache = await caches.open(PRIVATE_READ_CACHE);
  await cache.put(
    new Request(url, { method: "GET" }),
    new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Helpdesk-Cached-At": String(cachedAt),
      },
    })
  );
}

function cacheMaxAge(url) {
  return url.pathname === "/api/auth/me" ? AUTH_CACHE_MAX_AGE_MS : DATA_CACHE_MAX_AGE_MS;
}

async function validCachedResponse(requestOrUrl) {
  const request = typeof requestOrUrl === "string"
    ? new Request(requestOrUrl, { method: "GET" })
    : requestOrUrl;
  const url = new URL(request.url);
  const cache = await caches.open(PRIVATE_READ_CACHE);
  const cached = await cache.match(request);
  if (!cached) return null;

  const cachedAt = Number(cached.headers.get("X-Helpdesk-Cached-At") || "0");
  if (!cachedAt || Date.now() - cachedAt > cacheMaxAge(url)) {
    await cache.delete(request);
    return null;
  }
  return { response: cached, cachedAt };
}

async function markOfflineResponse(cached, cachedAt, sourceUrl) {
  const headers = new Headers(cached.headers);
  headers.set("X-Helpdesk-Offline-Cache", "1");
  headers.set("X-Helpdesk-Cached-At", String(cachedAt));
  const body = await cached.clone().arrayBuffer();
  await notifyClients({
    type: "OFFLINE_READ_USED",
    cachedAt,
    url: sourceUrl,
  });
  return new Response(body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

function jsonOfflineResponse(data, cachedAt, sourceUrl) {
  notifyClients({ type: "OFFLINE_READ_USED", cachedAt, url: sourceUrl });
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Helpdesk-Offline-Cache": "1",
      "X-Helpdesk-Cached-At": String(cachedAt),
    },
  });
}

function offlineUnavailable(detail) {
  return new Response(JSON.stringify({ detail }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchAndCachePrivate(url) {
  const request = new Request(url, {
    method: "GET",
    credentials: "include",
    headers: { "X-Requested-With": "HelpDeskCasma" },
  });
  const response = await fetch(request);
  if (response.ok) await storePrivateResponse(request, response.clone());
  return response;
}

async function buildTicketSnapshot() {
  const firstUrl = "/api/tickets?page=1&page_size=100";
  const first = await fetchAndCachePrivate(firstUrl);
  if (!first.ok) return false;

  const firstPage = await first.clone().json().catch(() => null);
  if (!firstPage?.items) return false;

  const items = [...firstPage.items];
  const pages = Math.min(5, Math.ceil(Number(firstPage.total || items.length) / 100));

  for (let page = 2; page <= pages; page += 1) {
    const url = `/api/tickets?page=${page}&page_size=100`;
    const response = await fetchAndCachePrivate(url);
    if (!response.ok) break;
    const data = await response.clone().json().catch(() => null);
    if (!data?.items) break;
    items.push(...data.items);
  }

  await storePrivateJson(TICKET_SNAPSHOT_URL, {
    items,
    total: items.length,
    server_total: Number(firstPage.total || items.length),
    generated_at: new Date().toISOString(),
  });
  return true;
}

let lastWarmAt = 0;

async function warmPrivateData(force = false) {
  if (!force && Date.now() - lastWarmAt < WARM_THROTTLE_MS) return;
  lastWarmAt = Date.now();

  const meResponse = await fetchAndCachePrivate("/api/auth/me").catch(() => null);
  if (!meResponse?.ok) return;

  await Promise.allSettled([
    buildTicketSnapshot(),
    ...CORE_PRIVATE_URLS
      .filter((url) => url !== "/api/auth/me")
      .map((url) => fetchAndCachePrivate(url)),
  ]);

  await notifyClients({ type: "OFFLINE_READ_CACHE_READY", cachedAt: Date.now() });
}

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function cachedJson(url) {
  const cached = await validCachedResponse(url);
  if (!cached) return null;
  const data = await cached.response.clone().json().catch(() => null);
  return data == null ? null : { data, cachedAt: cached.cachedAt };
}

async function currentStaffIdFromCache() {
  const me = await cachedJson("/api/auth/me");
  return me?.data?.kind === "staff" ? me.data.staff?.id ?? null : null;
}

async function synthesizeTickets(url) {
  const snapshot = await cachedJson(TICKET_SNAPSHOT_URL);
  if (!snapshot?.data?.items) return null;

  const path = url.pathname;
  if (path !== "/api/tickets") {
    if (
      path === "/api/tickets/kpis"
      || path.endsWith("/audit")
      || path.includes("/attachments/")
    ) return null;

    const match = path.match(/^\/api\/tickets\/([^/]+)$/);
    if (match) {
      const ticket = snapshot.data.items.find((item) => item.id === match[1]);
      return ticket ? jsonOfflineResponse(ticket, snapshot.cachedAt, url.href) : null;
    }
    return null;
  }

  let items = [...snapshot.data.items];
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const category = url.searchParams.get("category");
  const officeId = url.searchParams.get("office_id");
  const equipmentId = url.searchParams.get("equipment_id");
  const assigned = url.searchParams.get("assigned");
  const q = normalized(url.searchParams.get("q"));

  if (status) items = items.filter((item) => item.status === status);
  if (priority) items = items.filter((item) => item.priority === priority);
  if (category) items = items.filter((item) => item.category === category);
  if (officeId) items = items.filter((item) => item.office_id === officeId);
  if (equipmentId) items = items.filter((item) => item.equipment?.id === equipmentId);

  if (assigned === "none") {
    items = items.filter((item) => !item.assigned_to_id);
  } else if (assigned) {
    const assignedId = assigned === "me" ? await currentStaffIdFromCache() : assigned;
    if (assignedId) items = items.filter((item) => item.assigned_to_id === assignedId);
  }

  if (q) {
    items = items.filter((item) =>
      normalized([
        item.number,
        item.subject,
        item.description,
        item.office_name,
        item.equipment?.patrimonial_code,
      ].filter(Boolean).join(" ")).includes(q)
    );
  }

  const total = items.length;
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("page_size") || "20")));
  const start = (page - 1) * pageSize;
  return jsonOfflineResponse(
    { items: items.slice(start, start + pageSize), total, page, page_size: pageSize },
    snapshot.cachedAt,
    url.href,
  );
}

async function synthesizeEquipment(url) {
  const base = await cachedJson("/api/equipment");
  if (!base?.data || !Array.isArray(base.data)) return null;

  const path = url.pathname;
  if (path !== "/api/equipment") {
    if (
      path === "/api/equipment/import-references"
      || path.endsWith("/retirement-report")
      || path.endsWith("/qr")
    ) return null;

    const match = path.match(/^\/api\/equipment\/([^/]+)$/);
    if (match) {
      const equipment = base.data.find((item) => item.id === match[1]);
      if (!equipment) return null;
      const tickets = await cachedJson(TICKET_SNAPSHOT_URL);
      const related = tickets?.data?.items?.filter((ticket) => ticket.equipment?.id === match[1]) ?? [];
      return jsonOfflineResponse(
        { equipment, risk: null, risk_factors: [], tickets: related.slice(0, 50) },
        base.cachedAt,
        url.href,
      );
    }
    return null;
  }

  let items = [...base.data];
  const officeId = url.searchParams.get("office_id");
  const type = url.searchParams.get("type");
  const q = normalized(url.searchParams.get("q"));

  if (officeId) items = items.filter((item) => item.office_id === officeId);
  if (type) items = items.filter((item) => item.type === type);
  if (q) {
    items = items.filter((item) =>
      normalized([
        item.inventory_id,
        item.patrimonial_code,
        item.mac_address,
        item.ip_address,
        item.responsible_name,
        item.hostname,
        item.device_label,
        item.area,
        item.brand,
        item.model,
      ].filter(Boolean).join(" ")).includes(q)
    );
  }

  return jsonOfflineResponse(items, base.cachedAt, url.href);
}

async function synthesizeOrganizationUsers(url) {
  if (url.pathname !== "/api/organization/users") return null;
  const base = await cachedJson("/api/organization/users");
  if (!base?.data || !Array.isArray(base.data)) return null;

  let items = [...base.data];
  const officeId = url.searchParams.get("office_id");
  const zoneId = url.searchParams.get("zone_id");
  const active = url.searchParams.get("active");
  const q = normalized(url.searchParams.get("q"));

  if (officeId) items = items.filter((item) => item.office_id === officeId);
  if (zoneId) items = items.filter((item) => item.zone_id === zoneId);
  if (active === "true") items = items.filter((item) => item.active);
  if (active === "false") items = items.filter((item) => !item.active);
  if (q) {
    items = items.filter((item) =>
      normalized([
        item.full_name,
        item.employee_code,
        item.job_title,
        item.email,
      ].filter(Boolean).join(" ")).includes(q)
    );
  }
  return jsonOfflineResponse(items, base.cachedAt, url.href);
}

async function offlinePrivateFallback(request) {
  const url = new URL(request.url);

  const exact = await validCachedResponse(request);
  if (exact) return markOfflineResponse(exact.response, exact.cachedAt, url.href);

  if (url.pathname.startsWith("/api/tickets")) {
    const response = await synthesizeTickets(url);
    if (response) return response;
  }

  if (url.pathname.startsWith("/api/equipment")) {
    const response = await synthesizeEquipment(url);
    if (response) return response;
  }

  if (url.pathname === "/api/organization/users") {
    const response = await synthesizeOrganizationUsers(url);
    if (response) return response;
  }

  return offlineUnavailable("No hay una copia offline reciente para esta vista. Conéctese una vez para actualizarla.");
}

async function networkFirstPrivate(request) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      await storePrivateResponse(request, response.clone());
      return response;
    }
    if (![502, 503, 504].includes(response.status)) return response;
  } catch {
    // La red no está disponible. Se intenta la copia local.
  }
  return offlinePrivateFallback(request);
}

async function cacheVerifiedStaffSession(response) {
  if (!response.ok) return;
  await clearPrivateReadCache();
  const cache = await caches.open(PRIVATE_READ_CACHE);
  const stored = await responseWithCacheMetadata(response.clone());
  await cache.put(new Request("/api/auth/me", { method: "GET" }), stored);
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
  if (event.data?.type === "WARM_OFFLINE_DATA") {
    event.waitUntil(warmPrivateData(Boolean(event.data?.force)).catch(() => undefined));
  }
  if (event.data?.type === "CLEAR_PRIVATE_OFFLINE_CACHE") {
    event.waitUntil(clearPrivateReadCache());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/api/auth/logout") {
    event.respondWith((async () => {
      await clearPrivateReadCache();
      try {
        return await fetch(request.clone());
      } catch {
        return new Response(JSON.stringify({ message: "Sesión local cerrada." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    })());
    return;
  }

  if (
    request.method === "POST"
    && url.origin === self.location.origin
    && (url.pathname === "/api/auth/staff/mfa/verify" || url.pathname === "/api/auth/office/login")
  ) {
    event.respondWith((async () => {
      const response = await fetch(request.clone());
      if (response.ok) {
        if (url.pathname === "/api/auth/staff/mfa/verify") {
          await cacheVerifiedStaffSession(response.clone());
        } else {
          await clearPrivateReadCache();
        }
      }
      return response;
    })());
    return;
  }

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
        const response = await fetch(new Request(request.clone(), { headers: forwardedHeaders }));
        if (response.ok && scope === "staff") {
          event.waitUntil(warmPrivateData(false).catch(() => undefined));
        }
        return response;
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

  if (isPrivateReadableGet(request, url)) {
    event.respondWith(networkFirstPrivate(request));
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
