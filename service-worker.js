const CACHE_VERSION = "contas-pwa-v5";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = "offline.html";
const APP_ASSET_VERSION = "4.2.20";

const APP_SHELL_ASSETS = [
  "./",
  "index.html",
  OFFLINE_URL,
  "manifest.webmanifest",
  "style.css",
  `style.css?v=${APP_ASSET_VERSION}`,
  "mobile.css",
  `mobile.css?v=${APP_ASSET_VERSION}`,
  "app.js",
  "src/main.js",
  `src/main.js?v=${APP_ASSET_VERSION}`,
  "src/crypto/crypto.js",
  "src/firebase/auth.js",
  "src/firebase/firebaseApp.js",
  "src/firebase/firebaseConfig.js",
  "src/firebase/firestore.js",
  "src/modules/calendar.js",
  "src/modules/themes.js",
  "src/state/state.js",
  "src/state/storage.js",
  "src/utils/dates.js",
  "src/utils/formatters.js",
  "img/bg-site-sunset.webp",
  "img/bg-site-planetario.webp",
  "img/bg-site-natureza.webp",
  "img/bg-site-grayscale.webp",
  "img/bg-site-doce.webp",
  "img/bg-site-dark.webp",
  "img/bg-site-ceu.webp",
  "assets/icons/app-icon.svg",
  "assets/icons/favicon.svg",
  "assets/icons/loading-logo.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-192.png",
  "assets/icons/icon-maskable-512.png"
];

const STATIC_HOSTS = new Set([
  self.location.origin,
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdn.jsdelivr.net",
  "https://www.gstatic.com"
]);

const DYNAMIC_HOST_MATCHERS = [
  /(^|\.)googleapis\.com$/,
  /(^|\.)firebaseio\.com$/,
  /(^|\.)firebaseapp\.com$/,
  /(^|\.)firebasedatabase\.app$/,
  /(^|\.)identitytoolkit\.googleapis\.com$/,
  /(^|\.)securetoken\.googleapis\.com$/,
  /(^|\.)brasilapi\.com\.br$/
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS.map(toAppUrl)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("contas-pwa-") && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isDynamicRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isCacheableStaticRequest(request, url)) {
    event.respondWith(cacheFirstStatic(request));
  }
});

function isDynamicRequest(url) {
  return DYNAMIC_HOST_MATCHERS.some((matcher) => matcher.test(url.hostname));
}

function isCacheableStaticRequest(request, url) {
  if (!STATIC_HOSTS.has(url.origin)) return false;
  if (["style", "script", "image", "font"].includes(request.destination)) return true;
  return url.origin === self.location.origin && (
    url.pathname.endsWith(".webmanifest")
    || url.pathname.includes("/assets/icons/")
    || url.pathname.includes("/img/")
    || url.pathname.includes("/src/")
  );
}

function toAppUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

async function cacheFirstStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request, { ignoreSearch: true }))
      || (await caches.match(toAppUrl("index.html")))
      || (await caches.match(toAppUrl(OFFLINE_URL)));
  }
}
