# Fullsend admin (Svelte SPA)

This directory holds the **admin installation UI**: a **Svelte 5 + Vite** single-page app served under the `/admin/` base path, plus a small **Cloudflare Worker** used only in local development to exchange GitHub OAuth codes for user tokens (so the browser never sends `client_secret` to GitHub directly).

Production packaging of this app for the public site is tracked in the repo-wide implementation plan (`docs/superpowers/plans/2026-04-12-fullsend-admin-spa.md`).

## Tooling with mise

The repository root includes `mise.toml`, which pins **Node 22** and loads **`admin/.env.local`** when you use mise in this repo.

1. Install [mise](https://mise.jdx.dev/) if you do not already use it.
2. From the **repository root**: `mise trust` (required once per clone so mise will read `mise.toml`).
3. `cd` into the repo; `node` and `npm` should come from mise.

You can also use any Node 22 + npm install without mise; the app does not depend on mise at runtime.

## GitHub App (OAuth)

Create a **GitHub App** used for **user** sign-in to the admin UI (not the same as Fullsend agent apps):

1. GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App** (or your org’s equivalent).
2. **Homepage URL:** e.g. `http://localhost:5173` (or match your dev origin).
3. **Callback URL** must match what the SPA uses **exactly** (same host and path). With the default Vite dev server, register **one** of:
   - `http://localhost:5173/admin/`
   - `http://127.0.0.1:5173/admin/`
   Use the same host in the browser when testing (`localhost` vs `127.0.0.1` are different origins).
4. Webhooks can stay inactive for local dev.
5. After creation, note the **Client ID** and generate a **client secret** once; treat the secret like a password.

Details and comments for production follow-ups live in **`sample.env.local`** (committed template, not loaded by git).

## Environment file

1. Copy the template: `cp sample.env.local .env.local` (from this `admin/` directory).
2. Set `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` to your app’s values.
3. Keep **`.env.local` gitignored**; never commit secrets.

Vite only injects the **client id** into the client bundle. Wrangler reads `.env.local` for local Worker dev (including the client secret) when no `.dev.vars` file takes precedence—see comments in `sample.env.local`.

## Run the site locally

From **`admin/`**:

```bash
npm ci
npm run dev
```

Then open **`http://localhost:5173/admin/`** (or `127.0.0.1` if that matches your callback URL). You should see the shell; **Sign in with GitHub** runs the OAuth flow against the Worker on port **8787**, proxied by Vite as **`/api/*`**.

Other useful commands:

- **`npm run dev:debug`** — noisier Worker + Vite proxy logging.
- **`npm run dev:vite`** — Vite only (no token exchange; sign-in will not work).
- **`npm run build`** / **`npm run preview`** — production build and static preview.
- **`npm run test`** / **`npm run check`** — Vitest and `svelte-check`.
