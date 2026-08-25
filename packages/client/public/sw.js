/*
 * Service Worker.
 *
 * Das Spiel ist Multiplayer und braucht den Server — echtes Offline-Spielen
 * gibt es nicht. Der Worker hat deshalb nur zwei Aufgaben:
 *
 * 1. Die App-Hülle vorhalten, damit der Start vom Startbildschirm sofort geht
 *    und nicht erst auf das Netz wartet.
 * 2. Bei fehlender Verbindung eine verständliche Seite zeigen statt der
 *    Fehlerseite des Browsers.
 *
 * Schnittstellenaufrufe werden **nie** zwischengespeichert: Ein veralteter
 * Auktionsstand ist schlimmer als gar keiner.
 */

const CACHE = "soccer-world-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Schnittstelle: immer frisch, niemals aus dem Zwischenspeicher
  if (url.pathname.startsWith("/api/")) return;

  // Seitenaufrufe: Netz zuerst, bei Ausfall die gespeicherte Hülle
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? offlinePage())),
    );
    return;
  }

  // Statische Dateien: aus dem Zwischenspeicher, sonst holen und merken
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

function offlinePage() {
  return new Response(
    `<!doctype html><html lang="de"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Keine Verbindung</title>
     <style>
       body{background:#0b1120;color:#e7ecf5;font:16px/1.6 system-ui;
            display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}
       p{color:#8d9ab5;max-width:22em}
     </style></head><body><div>
     <h1>Keine Verbindung</h1>
     <p>Soccer World braucht den Server — der Markt läuft ja für alle
     gleichzeitig. Sobald du wieder online bist, geht es weiter.</p>
     </div></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
  );
}
