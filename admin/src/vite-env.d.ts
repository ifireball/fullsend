/// <reference types="svelte" />
/// <reference types="vite/client" />

/** Merged with `vite/client` (see `vite.config.ts` `base` and `define`). */
interface ImportMetaEnv {
  /** Vite `base` (e.g. `/admin/`). */
  readonly BASE: string;
  /** Injected from `GITHUB_APP_CLIENT_ID` in `.env.local` (never the secret). */
  readonly VITE_GITHUB_APP_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
