/**
 * GitHub App **manifest** creation flow (browser-only).
 *
 * CORS (verified 2026-04-26): `POST https://api.github.com/app-manifests/{code}/conversions`
 * responds with `access-control-allow-origin: *` on both OPTIONS preflight and POST
 * (tested with fake code → 404 + ACAO `*`). Prefer this direct `fetch` until GitHub
 * tightens policy; only then add a Worker BFF.
 *
 * **Return URL:** Same admin document entry as OAuth, with `?fullsend_app_manifest=1`
 * (see {@link getGithubAppManifestRedirectUri} in `oauth.ts`). {@link consumeManifestParamsFromDocumentUrl}
 * runs before OAuth so manifest `code=` is never mistaken for an OAuth authorization code.
 *
 * **Same-window manifest:** POST the manifest from the current document (form submit),
 * then GitHub redirects back; {@link completeManifestHandoffFromDoc} exchanges the code,
 * writes staging to `localStorage`, and records {@link MANIFEST_POST_RESULT_KEY} so the
 * org setup route can clear errors after return (cards reflect install state).
 *
 * Parity: `internal/forge/github/types.go` (`AgentAppConfig`) and
 * `internal/appsetup/appsetup.go` (`runManifestFlow`, `exchangeManifestCode`).
 */

import {
  MANIFEST_POST_RESULT_KEY,
  takeManifestDocHandoff,
  takeManifestReturnContext,
} from "../auth/oauth";
import { writeStagedAppMeta, writeStagedAppPem } from "../orgSetup/setupStorage";

const STAGING_SCM_HOST = "github.com";

export type ManifestPostResult =
  | { ok: true; installUrl: string; slug: string }
  | { ok: false; message: string };

export type ManifestExchangeResult = {
  appId: number;
  slug: string;
  name: string;
  pem: string;
  clientId: string;
  clientSecret: string;
  htmlUrl: string;
};

type HookAttributes = { url: string; active: boolean };

export type AgentAppManifestConfig = {
  name: string;
  description: string;
  url: string;
  hook_attributes: HookAttributes;
  redirect_url?: string;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

export function expectedAppSlug(org: string, role: string): string {
  return `${org}-${role}`;
}

export function buildAgentAppManifestConfig(
  org: string,
  role: string,
  redirectUrl: string,
): AgentAppManifestConfig {
  const base: AgentAppManifestConfig = {
    name: `${org}-${role}`,
    description: "",
    url: `https://github.com/${org}`,
    hook_attributes: {
      url: `https://github.com/${org}`,
      active: false,
    },
    public: false,
    default_permissions: {},
    default_events: [],
    redirect_url: redirectUrl,
  };

  switch (role) {
    case "fullsend":
      base.description = `Fullsend orchestrator for ${org}`;
      base.default_permissions = {
        contents: "write",
        issues: "read",
        pull_requests: "write",
        checks: "read",
        administration: "write",
        members: "read",
      };
      base.default_events = ["issues", "push", "workflow_dispatch"];
      break;
    case "triage":
      base.description = `Fullsend triage agent for ${org}`;
      base.default_permissions = { issues: "write" };
      base.default_events = ["issues", "issue_comment"];
      break;
    case "coder":
      base.description = `Fullsend coder agent for ${org}`;
      base.default_permissions = {
        issues: "read",
        contents: "write",
        pull_requests: "write",
        checks: "read",
      };
      base.default_events = [
        "issues",
        "issue_comment",
        "pull_request",
        "check_run",
        "check_suite",
      ];
      break;
    case "review":
      base.description = `Fullsend review agent for ${org}`;
      base.default_permissions = {
        pull_requests: "write",
        contents: "read",
        checks: "read",
      };
      base.default_events = ["pull_request", "pull_request_review"];
      break;
    default:
      base.description = `Fullsend ${role} agent for ${org}`;
      base.default_permissions = { issues: "read" };
      base.default_events = ["issues"];
  }

  return base;
}

export function githubOrgNewAppUrl(org: string): string {
  return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`;
}

export function githubAppInstallationsNewUrl(slug: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

/**
 * POSTs the manifest from this document (full navigation to GitHub).
 * Call {@link stashManifestReturnContext} in `oauth.ts` immediately before this.
 */
export function submitAgentAppManifestSameWindow(
  org: string,
  role: string,
  redirectUrl: string,
): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = githubOrgNewAppUrl(org);
  form.setAttribute("accept-charset", "UTF-8");
  form.style.display = "none";
  const manifestInput = document.createElement("input");
  manifestInput.type = "hidden";
  manifestInput.name = "manifest";
  manifestInput.value = JSON.stringify(
    buildAgentAppManifestConfig(org, role, redirectUrl),
  );
  form.appendChild(manifestInput);
  document.body.appendChild(form);
  form.submit();
}

export async function exchangeManifestCode(
  code: string,
  signal?: AbortSignal,
): Promise<ManifestExchangeResult> {
  const url = `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      res.ok
        ? "GitHub returned a non-JSON body for manifest conversion."
        : `Manifest conversion failed (${res.status}).`,
    );
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Manifest conversion failed (${res.status}).`;
    throw new Error(msg);
  }
  const o = body as Record<string, unknown>;
  const appId = typeof o.id === "number" ? o.id : Number(o.id);
  const slug = typeof o.slug === "string" ? o.slug : "";
  const name = typeof o.name === "string" ? o.name : "";
  const pem = typeof o.pem === "string" ? o.pem : "";
  const clientId = typeof o.client_id === "string" ? o.client_id : "";
  const clientSecret = typeof o.client_secret === "string" ? o.client_secret : "";
  const htmlUrl = typeof o.html_url === "string" ? o.html_url : "";
  if (!slug || !pem) {
    throw new Error("GitHub manifest response missing slug or pem.");
  }
  return {
    appId,
    slug,
    name,
    pem,
    clientId,
    clientSecret,
    htmlUrl,
  };
}

function setManifestPostResult(result: ManifestPostResult): void {
  try {
    sessionStorage.setItem(MANIFEST_POST_RESULT_KEY, JSON.stringify(result));
  } catch {
    /* ignore */
  }
}

/**
 * Runs after {@link consumeManifestParamsFromDocumentUrl} stashed the manifest `code`
 * and cleaned the document URL (same-window return from GitHub).
 */
export async function completeManifestHandoffFromDoc(
  signal?: AbortSignal,
): Promise<void> {
  const handoff = takeManifestDocHandoff();
  if (!handoff?.code) {
    takeManifestReturnContext();
    return;
  }
  const ctx = takeManifestReturnContext();

  if (!ctx) {
    setManifestPostResult({
      ok: false,
      message:
        "GitHub returned a manifest code but this browser had no return context (try Create app on GitHub again from org setup).",
    });
    return;
  }

  try {
    const r = await exchangeManifestCode(handoff.code, signal);
    writeStagedAppPem(STAGING_SCM_HOST, ctx.actorLogin, ctx.org, ctx.role, r.pem);
    writeStagedAppMeta(STAGING_SCM_HOST, ctx.actorLogin, ctx.org, ctx.role, {
      slug: r.slug,
      displayName: r.name,
    });
    const installUrl = githubAppInstallationsNewUrl(r.slug);
    setManifestPostResult({ ok: true, installUrl, slug: r.slug });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setManifestPostResult({ ok: false, message });
  }
}
