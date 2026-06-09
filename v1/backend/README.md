# Emby Probe Backend

Zero-dependency Node.js backend for `project_0/index5.html`.

## Run

```bash
cd E:\codexwork\project_0\backend
copy .env.example .env
npm start
```

The server listens on `http://127.0.0.1:8787` by default, serves `../index5.html` at `/`, and writes data to `data/store.json`.

Open the local app at:

```text
http://127.0.0.1:8787/
```

If `/` still returns `NOT_FOUND`, an old process is likely still using port `8787`. Stop the old terminal process and run `npm start` again.

## First Login

Default development credentials come from `.env`:

```json
{ "username": "admin", "password": "change-this-password" }
```

Use the returned token as:

```http
Authorization: Bearer <token>
```

## API Families

- `/api/v1/*` follows `BACKEND-SPEC.md`, including login, protected CRUD, libraries, stats and probe endpoints.
- `/api/*` keeps compatibility with `emby-probe-backend-setup.md`, including `/api/summary`, `/api/servers`, `/api/icon-libraries` and `/api/settings/current-icon-library`.

For local validation, `.env.example` sets `PUBLIC_WRITE_API=true`, so the frontend management panel can write through `/api/*` without a separate login screen. Set it to `false` if you want bearer-token protection for compatibility write endpoints.

## Emby Probe

For each configured server, probe uses the official Emby flow:

- `GET /System/Info/Public` first for basic reachability.
- `POST /Users/AuthenticateByName` when username/password are configured.
- `GET /Items/Counts` with either `X-Emby-Token` or `api_key`.

Passwords are encrypted at rest with AES-256-GCM using `APP_SECRET`. The backend never returns `password`, `apiKey`, or encrypted password fields to the frontend.
