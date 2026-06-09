import http from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(ROOT_DIR, '..');

loadDotEnv(path.join(ROOT_DIR, '.env'));

const CONFIG = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-this-password',
  adminDisplayName: process.env.ADMIN_DISPLAY_NAME || 'Probe Admin',
  adminToken: process.env.ADMIN_TOKEN || 'change-this-token',
  appSecret: process.env.APP_SECRET || 'dev-secret-change-me',
  dataPath: path.resolve(ROOT_DIR, process.env.DATA_PATH || './data/store.json'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  probeTimeoutMs: Number(process.env.PROBE_TIMEOUT_MS || 8000),
  refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS || 300000),
  allowPrivateEmbyUrls: readBool(process.env.ALLOW_PRIVATE_EMBY_URLS, true),
  publicWriteApi: readBool(process.env.PUBLIC_WRITE_API, true)
};

const DEFAULT_LIB = {
  id: 'carrot_icon_1',
  name: 'carrot_icon_1',
  baseUrl: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/',
  jsonUrl: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/carrot_icon.json',
  icons: [
    { name: 'Coolgua', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/Coolgua.png' },
    { name: 'Msky', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/Msky.png' },
    { name: 'kiku1', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/kiku1.png' },
    { name: 'KL1', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/KL1.png' },
    { name: 'totoro', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/totoro.png' },
    { name: 'KITI', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/KITI.png' },
    { name: 'xiami', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/xiami.png' },
    { name: 'Gousen', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/Gousen.png' },
    { name: 'feiniu', url: 'https://raw.githubusercontent.com/Carrottor/carrot_icon_1/refs/heads/main/icon/feiniu.png' }
  ],
  isProtected: true
};

const SEED_SERVERS = [
  { id: 'mainemby', name: 'Main Emby', iconName: 'Coolgua', movies: 14872, series: 2384, seasons: 0, episodes: 38210, layer: 'local' },
  { id: 'backup', name: 'Backup Emby', iconName: 'Msky', movies: 9120, series: 1502, seasons: 0, episodes: 24180, layer: 'local' },
  { id: 'archive4k', name: '4K Archive', iconName: 'kiku1', movies: 1842, series: 18, seasons: 0, episodes: 240, layer: 'local' },
  { id: 'animelib', name: 'Anime Lib', iconName: 'KL1', movies: 912, series: 740, seasons: 0, episodes: 18450, layer: 'remote' },
  { id: 'musichall', name: 'Music Hall', iconName: 'totoro', movies: 0, series: 62, seasons: 0, episodes: 1840, layer: 'remote' },
  { id: 'testlab', name: 'Test Lab', iconName: 'KITI', movies: 204, series: 86, seasons: 0, episodes: 1908, layer: 'remote' },
  { id: 'family', name: 'Family Vault', iconName: 'xiami', movies: 640, series: 184, seasons: 0, episodes: 3902, layer: 'archive' },
  { id: 'doc', name: 'Documentary', iconName: 'Gousen', movies: 482, series: 92, seasons: 0, episodes: 1284, layer: 'archive' },
  { id: 'sandbox', name: 'Sandbox Beta', iconName: 'feiniu', movies: 38, series: 12, seasons: 0, episodes: 186, layer: 'archive' }
];
const SEED_SERVER_IDS = new Set(SEED_SERVERS.map((server) => server.id));

const LAYER_TITLES = {
  local: 'LOCAL · 本地',
  remote: 'REMOTE · 远端',
  archive: 'ARCHIVE · 档案'
};

let store = await loadStore();
let writeQueue = Promise.resolve();
const probeRateLimit = new Map();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendError(res, 500, 'INTERNAL', 'Internal server error');
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Emby Probe backend listening on http://${CONFIG.host}:${CONFIG.port}`);
});

if (CONFIG.refreshIntervalMs > 0) {
  setInterval(() => {
    probeAllConfiguredServers().catch((error) => console.warn('scheduled probe failed:', error.message));
  }, CONFIG.refreshIntervalMs).unref();
}

async function handleRequest(req, res) {
  try {
    await dispatchRequest(req, res);
  } catch (error) {
    if (error.status && error.code) {
      sendError(res, error.status, error.code, error.message, error.detail);
      return;
    }
    console.error(error);
    sendError(res, 500, 'INTERNAL', 'Internal server error');
  }
}

async function dispatchRequest(req, res) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = normalizePath(url.pathname);

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    await sendFile(res, path.join(PROJECT_DIR, 'index5.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/mq5bhoxr-image.png') {
    await sendFile(res, path.join(PROJECT_DIR, 'mq5bhoxr-image.png'), 'image/png');
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const assetName = path.basename(pathname);
    await sendFile(res, path.join(PROJECT_DIR, 'assets', assetName), contentTypeFor(assetName));
    return;
  }

  if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/api/v1/health')) {
    sendJson(res, 200, { ok: true, time: nowIso() });
    return;
  }

  if (pathname === '/api/v1/auth/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (pathname.startsWith('/api/v1/')) {
    const user = requireAuth(req, res);
    if (!user) return;
    await routeV1(req, res, url, pathname, user);
    return;
  }

  if (pathname.startsWith('/api/')) {
    await routeCompat(req, res, url, pathname);
    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'Route not found');
}

async function routeV1(req, res, url, pathname, user) {
  if (pathname === '/api/v1/me' && req.method === 'GET') {
    sendJson(res, 200, { user });
    return;
  }

  if (pathname === '/api/v1/servers' && req.method === 'GET') {
    if (url.searchParams.get('probe') === 'fresh') {
      await probeAllConfiguredServers();
    }
    const layer = url.searchParams.get('layer');
    let servers = store.servers.map(publicServer);
    if (layer) servers = servers.filter((server) => server.layer === layer);
    sendJson(res, 200, { servers });
    return;
  }

  if (pathname === '/api/v1/servers' && req.method === 'POST') {
    const body = await readJson(req);
    const server = await createServer(body);
    sendJson(res, 201, { server: publicServer(server) });
    return;
  }

  const serverMatch = pathname.match(/^\/api\/v1\/servers\/([^/]+)(?:\/(probe|probe\/latest))?$/);
  if (serverMatch) {
    const id = decodeURIComponent(serverMatch[1]);
    const action = serverMatch[2] || '';

    if (!action && req.method === 'PUT') {
      const body = await readJson(req);
      const server = await updateServer(id, body);
      sendJson(res, 200, { server: publicServer(server) });
      return;
    }

    if (!action && req.method === 'PATCH') {
      const body = await readJson(req);
      const server = await updateServer(id, body);
      sendJson(res, 200, { server: publicServer(server) });
      return;
    }

    if (!action && req.method === 'DELETE') {
      await deleteServer(id);
      sendJson(res, 200, { deleted: true });
      return;
    }

    if (action === 'probe' && req.method === 'POST') {
      await readOptionalJson(req);
      const result = await probeServerById(id, user.id);
      sendJson(res, result.ok ? 200 : statusToHttp(result), { result });
      return;
    }

    if (action === 'probe/latest' && req.method === 'GET') {
      const latest = latestProbeFor(id);
      if (!latest) {
        sendError(res, 404, 'PROBE_NOT_FOUND', 'No probe result exists for this server');
        return;
      }
      sendJson(res, 200, { result: latest });
      return;
    }
  }

  if (pathname === '/api/v1/libs' && req.method === 'GET') {
    sendJson(res, 200, { libs: store.libs });
    return;
  }

  if (pathname === '/api/v1/libs' && req.method === 'POST') {
    const body = await readJson(req);
    const lib = await createIconLibrary(body);
    sendJson(res, 201, { lib });
    return;
  }

  const libMatch = pathname.match(/^\/api\/v1\/libs\/([^/]+)(?:\/refresh)?$/);
  if (libMatch) {
    const id = decodeURIComponent(libMatch[1]);

    if (pathname.endsWith('/refresh') && req.method === 'POST') {
      const lib = await refreshIconLibrary(id);
      sendJson(res, 200, { lib });
      return;
    }

    if (req.method === 'DELETE') {
      await deleteIconLibrary(id);
      sendJson(res, 200, { deleted: true });
      return;
    }
  }

  if (pathname === '/api/v1/stats/overview' && req.method === 'GET') {
    sendJson(res, 200, buildOverview());
    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'Route not found');
}

async function routeCompat(req, res, url, pathname) {
  if (pathname === '/api/summary' && req.method === 'GET') {
    sendJson(res, 200, buildSummary());
    return;
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    if (!requireCompatAuth(req, res)) return;
    await probeAllConfiguredServers();
    sendJson(res, 200, { ok: true, updatedAt: nowIso() });
    return;
  }

  if (pathname === '/api/servers' && req.method === 'GET') {
    sendJson(res, 200, store.servers.map(publicServer));
    return;
  }

  if (pathname === '/api/servers' && req.method === 'POST') {
    if (!requireCompatAuth(req, res)) return;
    const server = await createServer(await readJson(req));
    sendJson(res, 201, publicServer(server));
    return;
  }

  const serverMatch = pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (serverMatch && (req.method === 'PATCH' || req.method === 'PUT')) {
    if (!requireCompatAuth(req, res)) return;
    const server = await updateServer(decodeURIComponent(serverMatch[1]), await readJson(req));
    sendJson(res, 200, publicServer(server));
    return;
  }

  if (serverMatch && req.method === 'DELETE') {
    if (!requireCompatAuth(req, res)) return;
    await deleteServer(decodeURIComponent(serverMatch[1]));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/icon-libraries' && req.method === 'GET') {
    sendJson(res, 200, { currentLibId: store.currentLibId, libraries: store.libs });
    return;
  }

  if (pathname === '/api/icon-libraries' && req.method === 'POST') {
    if (!requireCompatAuth(req, res)) return;
    const lib = await createIconLibrary(await readJson(req));
    sendJson(res, 201, lib);
    return;
  }

  const compatLibRefreshMatch = pathname.match(/^\/api\/icon-libraries\/([^/]+)\/refresh$/);
  if (compatLibRefreshMatch && req.method === 'POST') {
    if (!requireCompatAuth(req, res)) return;
    const lib = await refreshIconLibrary(decodeURIComponent(compatLibRefreshMatch[1]));
    sendJson(res, 200, lib);
    return;
  }

  if (pathname === '/api/settings/current-icon-library' && req.method === 'PATCH') {
    if (!requireCompatAuth(req, res)) return;
    const body = await readJson(req);
    const libId = stringOr(body.libId, '');
    if (!store.libs.some((lib) => lib.id === libId)) {
      sendError(res, 404, 'LIB_NOT_FOUND', 'Icon library not found');
      return;
    }
    store.currentLibId = libId;
    await persistStore();
    sendJson(res, 200, { ok: true, currentLibId: libId });
    return;
  }

  sendError(res, 404, 'NOT_FOUND', 'Route not found');
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  if (body.username !== CONFIG.adminUsername || body.password !== CONFIG.adminPassword) {
    sendError(res, 401, 'AUTH_BAD_CREDENTIALS', 'Invalid username or password');
    return;
  }
  const user = defaultUser();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = signToken({ sub: user.id, username: user.username, exp: Math.floor(Date.parse(expiresAt) / 1000) });
  sendJson(res, 200, { token, user, expiresAt });
}

async function createServer(input) {
  const now = nowIso();
  const name = stringOr(input.name, '').trim();
  const url = trimTrailingSlash(stringOr(input.url, ''));
  const libId = stringOr(input.libId, DEFAULT_LIB.id);

  if (!name) throw httpError(422, 'SERVER_NAME_REQUIRED', 'Server name is required');
  if (url && !isHttpUrl(url)) throw httpError(422, 'SERVER_BAD_URL', 'Server URL must be http or https');
  if (store.servers.some((server) => server.name.toLowerCase() === name.toLowerCase())) {
    throw httpError(409, 'SERVER_DUPLICATE_NAME', 'Server name already exists');
  }
  if (!store.libs.some((lib) => lib.id === libId)) {
    throw httpError(404, 'LIB_NOT_FOUND', 'Icon library not found');
  }

  const iconName = stringOr(input.iconName || input.icon, 'Coolgua');
  const server = {
    id: slugify(input.id || name),
    name,
    url,
    account: stringOr(input.account, ''),
    passwordEnc: input.password ? encryptSecret(String(input.password)) : '',
    apiKeyEnc: input.apiKey ? encryptSecret(String(input.apiKey)) : '',
    iconName,
    iconUrl: stringOr(input.iconUrl, DEFAULT_LIB.baseUrl + encodeURIComponent(iconName) + '.png'),
    libId,
    layer: normalizeLayer(input.layer),
    note: stringOr(input.note, ''),
    movies: numberOr(input.movies, 0),
    series: numberOr(input.series, 0),
    seasons: numberOr(input.seasons, 0),
    episodes: numberOr(input.episodes, 0),
    status: stringOr(input.status, 'unknown'),
    lastSeenAt: null,
    lastProbedAt: null,
    createdAt: now,
    updatedAt: now
  };
  server.id = uniqueServerId(server.id);
  store.servers.push(server);
  await persistStore();
  return server;
}

async function updateServer(id, input) {
  const server = findServer(id);
  const nextName = input.name === undefined ? server.name : stringOr(input.name, '').trim();
  if (!nextName) throw httpError(422, 'SERVER_NAME_REQUIRED', 'Server name is required');

  if (
    nextName.toLowerCase() !== server.name.toLowerCase() &&
    store.servers.some((candidate) => candidate.id !== id && candidate.name.toLowerCase() === nextName.toLowerCase())
  ) {
    throw httpError(409, 'SERVER_DUPLICATE_NAME', 'Server name already exists');
  }

  if (input.url !== undefined) {
    const newUrl = trimTrailingSlash(stringOr(input.url, ''));
    if (newUrl && !isHttpUrl(newUrl)) throw httpError(422, 'SERVER_BAD_URL', 'Server URL must be http or https');
    server.url = newUrl;
  }

  if (input.libId !== undefined && !store.libs.some((lib) => lib.id === input.libId)) {
    throw httpError(404, 'LIB_NOT_FOUND', 'Icon library not found');
  }

  server.name = nextName;
  if (input.account !== undefined) server.account = stringOr(input.account, '');
  if (input.password) server.passwordEnc = encryptSecret(String(input.password));
  if (input.apiKey) server.apiKeyEnc = encryptSecret(String(input.apiKey));
  if (input.iconName !== undefined || input.icon !== undefined) server.iconName = stringOr(input.iconName || input.icon, server.iconName);
  if (input.iconUrl !== undefined) server.iconUrl = stringOr(input.iconUrl, '');
  if (input.libId !== undefined) server.libId = stringOr(input.libId, DEFAULT_LIB.id);
  if (input.layer !== undefined) server.layer = normalizeLayer(input.layer);
  if (input.note !== undefined) server.note = stringOr(input.note, '');
  server.updatedAt = nowIso();
  await persistStore();
  return server;
}

async function deleteServer(id) {
  const before = store.servers.length;
  store.servers = store.servers.filter((server) => server.id !== id);
  store.probeResults = store.probeResults.filter((result) => result.serverId !== id);
  if (store.servers.length === before) throw httpError(404, 'SERVER_NOT_FOUND', 'Server not found');
  await persistStore();
}

async function createIconLibrary(input) {
  const name = stringOr(input.name, '').trim() || 'icon-library';
  const jsonUrl = stringOr(input.jsonUrl, '').trim();
  if (!isHttpsUrl(jsonUrl)) throw httpError(422, 'LIB_BAD_URL', 'Icon JSON URL must be https');
  if (!isAllowedIconHost(jsonUrl)) throw httpError(403, 'LIB_HOST_BLOCKED', 'Icon JSON host is not allowed');
  if (store.libs.some((lib) => lib.jsonUrl === jsonUrl)) {
    throw httpError(409, 'LIB_DUPLICATE_JSON_URL', 'Icon library JSON URL already exists');
  }

  const fetched = await fetchIconJson(jsonUrl);
  const icons = parseIconJson(fetched.data);
  if (!icons.length) throw httpError(422, 'LIB_PARSE_FAIL', 'No usable icons found in JSON');

  const now = nowIso();
  const lib = {
    id: uniqueLibId(slugify(input.id || name)),
    name,
    baseUrl: stringOr(input.baseUrl, inferBaseUrl(icons[0]?.url) || ''),
    jsonUrl,
    icons,
    isProtected: false,
    createdAt: now,
    updatedAt: now
  };
  store.libs.push(lib);
  await persistStore();
  return lib;
}

async function refreshIconLibrary(id) {
  const lib = store.libs.find((candidate) => candidate.id === id);
  if (!lib) throw httpError(404, 'LIB_NOT_FOUND', 'Icon library not found');
  const fetched = await fetchIconJson(lib.jsonUrl);
  const icons = parseIconJson(fetched.data);
  if (!icons.length) throw httpError(422, 'LIB_PARSE_FAIL', 'No usable icons found in JSON');
  lib.icons = icons;
  lib.baseUrl = lib.baseUrl || inferBaseUrl(icons[0]?.url) || '';
  lib.updatedAt = nowIso();
  await persistStore();
  return lib;
}

async function deleteIconLibrary(id) {
  const lib = store.libs.find((candidate) => candidate.id === id);
  if (!lib) throw httpError(404, 'LIB_NOT_FOUND', 'Icon library not found');
  if (lib.isProtected || lib.id === DEFAULT_LIB.id) throw httpError(423, 'LIB_PROTECTED', 'Default icon library cannot be deleted');
  store.libs = store.libs.filter((candidate) => candidate.id !== id);
  if (store.currentLibId === id) store.currentLibId = DEFAULT_LIB.id;
  await persistStore();
}

async function probeAllConfiguredServers() {
  const configured = store.servers.filter((server) => server.url);
  const results = [];
  for (const server of configured) {
    results.push(await probeServer(server));
  }
  return results;
}

async function probeServerById(id, userId) {
  const key = `${userId}:${id}`;
  const last = probeRateLimit.get(key) || 0;
  if (Date.now() - last < 10_000) {
    throw httpError(429, 'RATE_LIMITED', 'Probe can be triggered once every 10 seconds per server');
  }
  probeRateLimit.set(key, Date.now());
  return probeServer(findServer(id));
}

async function probeServer(server) {
  const probedAt = nowIso();
  const started = performance.now();

  if (!server.url) {
    const result = makeProbeResult(server.id, false, 'unknown', null, null, 'PROBE_UNCONFIGURED', 'Server URL is empty', probedAt);
    await saveProbeResult(server, result);
    return result;
  }

  try {
    assertProbeUrlAllowed(server.url);

    const publicInfo = await embyFetch(server.url, '/System/Info/Public', {
      timeoutMs: CONFIG.probeTimeoutMs,
      deviceId: server.id
    });
    let token = '';
    const apiKey = decryptSecret(server.apiKeyEnc);
    const password = decryptSecret(server.passwordEnc);

    if (!apiKey && server.account && password) {
      const auth = await embyFetch(server.url, '/Users/AuthenticateByName', {
        method: 'POST',
        timeoutMs: CONFIG.probeTimeoutMs,
        deviceId: server.id,
        body: { Username: server.account, Pw: password }
      });
      token = stringOr(auth.AccessToken, '');
      if (!token) throw httpError(401, 'PROBE_AUTH_FAIL', 'Emby authentication did not return an access token');
    }

    const counts = await embyFetch(server.url, '/Items/Counts', {
      timeoutMs: CONFIG.probeTimeoutMs,
      deviceId: server.id,
      token,
      apiKey
    });

    const latencyMs = Math.round(performance.now() - started);
    const status = latencyMs > 1500 ? 'degraded' : 'online';
    const stats = {
      movies: numberOr(counts.MovieCount, 0),
      series: numberOr(counts.SeriesCount, 0),
      seasons: numberOr(counts.SeasonCount, 0),
      episodes: numberOr(counts.EpisodeCount, 0),
      users: numberOr(counts.UserCount, 0),
      version: stringOr(publicInfo.Version, '')
    };

    if (publicInfo.ServerName) server.name = String(publicInfo.ServerName);
    const result = {
      serverId: server.id,
      ok: true,
      status,
      latencyMs,
      stats,
      warnings: token || apiKey ? [] : ['Counts requested without Emby credentials; configure apiKey or account/password if this server requires auth.'],
      error: null,
      probedAt
    };
    await saveProbeResult(server, result);
    return result;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const normalized = normalizeProbeError(error);
    const result = makeProbeResult(server.id, false, normalized.status, latencyMs, null, normalized.code, normalized.message, probedAt);
    await saveProbeResult(server, result);
    return result;
  }
}

async function saveProbeResult(server, result) {
  server.lastProbedAt = result.probedAt;
  server.status = result.status;
  server.updatedAt = nowIso();
  if (result.ok) {
    server.lastSeenAt = result.probedAt;
    server.movies = result.stats.movies;
    server.series = result.stats.series;
    server.seasons = result.stats.seasons;
    server.episodes = result.stats.episodes;
  }
  store.probeResults.push(result);
  store.probeResults = store.probeResults.slice(-500);
  await persistStore();
}

async function embyFetch(baseUrl, endpoint, options = {}) {
  const url = new URL(endpoint.replace(/^\//, ''), trimTrailingSlash(baseUrl) + '/');
  if (options.apiKey) url.searchParams.set('api_key', options.apiKey);

  const headers = buildEmbyClientHeaders(options.deviceId, options.token);
  if (options.body) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || CONFIG.probeTimeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw httpError(502, 'PROBE_PROTOCOL_ERROR', 'Emby returned a non-JSON response');
      }
    }
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? 'PROBE_AUTH_FAIL' : 'PROBE_PROTOCOL_ERROR';
      throw httpError(response.status, code, `Emby returned HTTP ${response.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function buildEmbyClientHeaders(deviceId, token = '') {
  const safeDeviceId = String(deviceId || 'forward').trim() || 'forward';
  const authHeaderParts = [
    'MediaBrowser Client="Forward"',
    'Device="Forward"',
    `DeviceId="${safeDeviceId}"`,
    'Version="2.6.0"'
  ];
  if (token) authHeaderParts.push(`Token="${token}"`);
  const authHeader = authHeaderParts.join(', ');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: authHeader,
    'X-Emby-Authorization': authHeader,
    'X-Emby-Client': 'Forward',
    'X-Emby-Device-Name': 'Forward',
    'X-Emby-Device-Id': safeDeviceId,
    'X-Emby-Client-Version': '2.6.0',
    'User-Agent': 'Forward/2.6.0'
  };
  if (token) headers['X-Emby-Token'] = token;
  return headers;
}

function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    account: server.account || '',
    iconName: server.iconName,
    icon: server.iconName,
    iconUrl: server.iconUrl,
    libId: server.libId,
    layer: server.layer,
    note: server.note || '',
    movies: numberOr(server.movies, 0),
    series: numberOr(server.series, 0),
    seasons: numberOr(server.seasons, 0),
    episodes: numberOr(server.episodes, 0),
    status: server.status || 'unknown',
    lastSeenAt: server.lastSeenAt || null,
    lastProbedAt: server.lastProbedAt || null,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt
  };
}

function buildOverview() {
  const servers = store.servers.map(publicServer);
  return {
    servers: servers.length,
    online: servers.filter((server) => server.status === 'online' || server.status === 'degraded').length,
    movies: sum(servers, 'movies'),
    series: sum(servers, 'series'),
    episodes: sum(servers, 'episodes'),
    updatedAt: nowIso()
  };
}

function buildSummary() {
  const servers = store.servers.map(publicServer);
  const layerOrder = ['local', 'remote', 'archive'];
  return {
    updatedAt: nowIso(),
    totals: {
      servers: servers.length,
      movies: sum(servers, 'movies'),
      series: sum(servers, 'series'),
      episodes: sum(servers, 'episodes')
    },
    servers: servers.map((server) => ({
      ...server,
      latencyMs: latestProbeFor(server.id)?.latencyMs ?? null
    })),
    layers: layerOrder.map((layer) => ({
      title: LAYER_TITLES[layer],
      key: layer,
      servers: servers.filter((server) => server.layer === layer).map((server) => server.id)
    }))
  };
}

function latestProbeFor(serverId) {
  for (let i = store.probeResults.length - 1; i >= 0; i -= 1) {
    if (store.probeResults[i].serverId === serverId) return store.probeResults[i];
  }
  return null;
}

async function fetchIconJson(jsonUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(jsonUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw httpError(502, 'LIB_FETCH_FAIL', `Icon JSON returned HTTP ${response.status}`);
    return { data: await response.json() };
  } catch (error) {
    if (error.status) throw error;
    throw httpError(502, 'LIB_FETCH_FAIL', `Failed to fetch icon JSON: ${error.message}`);
  }
}

function parseIconJson(data) {
  let icons = [];
  if (Array.isArray(data)) {
    icons = data.map(iconFromEntry).filter(Boolean);
  } else if (data && typeof data === 'object' && Array.isArray(data.icons)) {
    icons = data.icons.map(iconFromEntry).filter(Boolean);
  } else if (data && typeof data === 'object') {
    icons = Object.entries(data)
      .filter(([, value]) => typeof value === 'string')
      .map(([name, url]) => ({ name, url }));
  }

  const seen = new Set();
  return icons
    .filter((icon) => icon.name && icon.url && !icon.name.startsWith('未采用'))
    .filter((icon) => {
      const key = `${icon.name}|${icon.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function iconFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = stringOr(entry.name || entry.title || entry.icon, '').trim();
  const url = stringOr(entry.url || entry.src || entry.href, '').trim();
  if (!name || !url) return null;
  return { name, url };
}

async function loadStore() {
  await fs.mkdir(path.dirname(CONFIG.dataPath), { recursive: true });
  try {
    const raw = await fs.readFile(CONFIG.dataPath, 'utf8');
    const loaded = JSON.parse(raw);
    return normalizeStore(loaded);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not read store, creating a fresh one: ${error.message}`);
    }
    const seeded = normalizeStore({});
    await fs.writeFile(CONFIG.dataPath, JSON.stringify(seeded, null, 2), 'utf8');
    return seeded;
  }
}

function normalizeStore(input) {
  const now = nowIso();
  const libs = Array.isArray(input.libs) ? input.libs : [];
  if (!libs.some((lib) => lib.id === DEFAULT_LIB.id)) {
    libs.unshift({ ...DEFAULT_LIB, createdAt: now, updatedAt: now });
  }

  const servers = Array.isArray(input.servers)
    ? input.servers.filter((server) => !isSeedPlaceholderServer(server))
    : [];

  return {
    version: 1,
    users: [defaultUser()],
    currentLibId: input.currentLibId || DEFAULT_LIB.id,
    libs,
    servers: servers.map((server) => ({
      seasons: 0,
      note: '',
      status: 'unknown',
      lastSeenAt: null,
      lastProbedAt: null,
      createdAt: now,
      updatedAt: now,
      ...server,
      layer: normalizeLayer(server.layer)
    })),
    probeResults: Array.isArray(input.probeResults) ? input.probeResults : []
  };
}

function isSeedPlaceholderServer(server) {
  return server && SEED_SERVER_IDS.has(server.id) && !server.url;
}

async function persistStore() {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(CONFIG.dataPath), { recursive: true });
    const tmp = `${CONFIG.dataPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await fs.rename(tmp, CONFIG.dataPath);
  });
  return writeQueue;
}

function requireAuth(req, res) {
  const token = bearerToken(req);
  if (!token) {
    sendError(res, 401, 'AUTH_TOKEN_REQUIRED', 'Authorization bearer token is required');
    return null;
  }
  if (CONFIG.adminToken && token === CONFIG.adminToken) return defaultUser();
  const payload = verifyToken(token);
  if (!payload) {
    sendError(res, 401, 'AUTH_TOKEN_EXPIRED', 'Token is invalid or expired');
    return null;
  }
  return defaultUser();
}

function requireCompatAuth(req, res) {
  if (CONFIG.publicWriteApi) return true;
  const token = bearerToken(req);
  if (!CONFIG.adminToken || token === CONFIG.adminToken || verifyToken(token)) return true;
  sendError(res, 401, 'AUTH_TOKEN_REQUIRED', 'Protected endpoint requires a bearer token');
  return false;
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function signToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', CONFIG.appSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', CONFIG.appSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (parts[2].length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(CONFIG.appSecret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  if (!String(value).startsWith('v1:')) return '';
  const [, ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  try {
    const key = crypto.createHash('sha256').update(CONFIG.appSecret).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
}

async function readOptionalJson(req) {
  try {
    return await readJson(req);
  } catch {
    return {};
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(httpError(413, 'BODY_TOO_LARGE', 'Request body is too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function sendFile(res, filePath, contentType) {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length
    });
    res.end(body);
  } catch {
    sendError(res, 404, 'NOT_FOUND', 'File not found');
  }
}

function sendError(res, status, code, message, detail) {
  sendJson(res, status, { error: { code, message, detail: detail || undefined } });
}

function contentTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CONFIG.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function httpError(status, code, message, detail) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.detail = detail;
  return error;
}

process.on('uncaughtException', (error) => {
  console.error('uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('unhandled rejection:', error);
});

function normalizeProbeError(error) {
  if (error.name === 'AbortError') {
    return { status: 'offline', code: 'PROBE_TIMEOUT', message: `Server did not respond in ${CONFIG.probeTimeoutMs}ms` };
  }
  if (error.code === 'PROBE_AUTH_FAIL') {
    return { status: 'error', code: 'PROBE_AUTH_FAIL', message: error.message };
  }
  if (error.code === 'PROBE_PROTOCOL_ERROR') {
    return { status: 'error', code: 'PROBE_PROTOCOL_ERROR', message: error.message };
  }
  if (error.code === 'PROBE_HOST_BLOCKED') {
    return { status: 'error', code: 'PROBE_HOST_BLOCKED', message: error.message };
  }
  return { status: 'offline', code: 'PROBE_UNREACHABLE', message: error.message || 'Server is unreachable' };
}

function statusToHttp(result) {
  const code = result.error?.code;
  if (code === 'PROBE_TIMEOUT') return 504;
  if (code === 'PROBE_AUTH_FAIL') return 401;
  if (code === 'PROBE_HOST_BLOCKED') return 403;
  return 502;
}

function makeProbeResult(serverId, ok, status, latencyMs, stats, code, message, probedAt) {
  return {
    serverId,
    ok,
    status,
    latencyMs,
    stats: stats || { movies: 0, series: 0, seasons: 0, episodes: 0, users: 0, version: '' },
    warnings: [],
    error: code ? { code, message } : null,
    probedAt
  };
}

function findServer(id) {
  const server = store.servers.find((candidate) => candidate.id === id);
  if (!server) throw httpError(404, 'SERVER_NOT_FOUND', 'Server not found');
  return server;
}

function defaultUser() {
  return {
    id: 'u_1',
    username: CONFIG.adminUsername,
    displayName: CONFIG.adminDisplayName,
    createdAt: '2026-06-09T00:00:00.000Z'
  };
}

function assertProbeUrlAllowed(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw httpError(422, 'SERVER_BAD_URL', 'Server URL must be http or https');
  }
  if (CONFIG.allowPrivateEmbyUrls) return;
  if (isPrivateHost(url.hostname)) {
    throw httpError(403, 'PROBE_HOST_BLOCKED', 'Private network Emby URLs are disabled');
  }
}

function isPrivateHost(host) {
  if (host === 'localhost') return true;
  if (net.isIP(host) === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254);
  }
  if (net.isIP(host) === 6) return host === '::1' || host.toLowerCase().startsWith('fc') || host.toLowerCase().startsWith('fd');
  return false;
}

function isAllowedIconHost(value) {
  const allowed = new Set(['raw.githubusercontent.com', 'gitlab.com', 'cdn.jsdelivr.net']);
  return allowed.has(new URL(value).hostname.toLowerCase());
}

function inferBaseUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/[^/]*$/, '');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function uniqueServerId(base) {
  let id = base || crypto.randomUUID();
  let index = 2;
  while (store.servers.some((server) => server.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function uniqueLibId(base) {
  let id = base || crypto.randomUUID();
  let index = 2;
  while (store.libs.some((lib) => lib.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function normalizeLayer(value) {
  const layer = String(value || 'local').toLowerCase();
  if (layer.includes('remote') || layer.includes('远端')) return 'remote';
  if (layer.includes('archive') || layer.includes('档案')) return 'archive';
  return 'local';
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || crypto.randomUUID();
}

function stringOr(value, fallback) {
  return value === undefined || value === null ? fallback : String(value);
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sum(items, key) {
  return items.reduce((total, item) => total + numberOr(item[key], 0), 0);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizePath(value) {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function nowIso() {
  return new Date().toISOString();
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function readBool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}
