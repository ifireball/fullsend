import { RequestError } from "@octokit/request-error";

/** Lowercase header names as returned by Octokit. */
function headerGet(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function githubApiMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const m = (data as { message?: unknown }).message;
  return typeof m === "string" && m.trim() ? m.trim() : undefined;
}

/** GitHub JSON `message` on 403s that are access / scope / org-policy — not REST rate limits. */
function github403BodyLooksLikePermissionDenied(apiMsg: string | undefined): boolean {
  if (!apiMsg?.trim()) return false;
  const m = apiMsg.toLowerCase();
  return (
    m.includes("resource not accessible") ||
    m.includes("although you appear to have the correct authorization credentials") ||
    m.includes("oauth app access restrictions") ||
    m.includes("organization has enabled or enforced") ||
    m.includes("saml") ||
    (m.includes("sso") && m.includes("token"))
  );
}

function github403BodyLooksLikeRateLimit(apiMsg: string | undefined): boolean {
  if (!apiMsg?.trim()) return false;
  const m = apiMsg.toLowerCase();
  return (
    m.includes("api rate limit") ||
    m.includes("secondary rate limit") ||
    m.includes("abuse detection mechanism") ||
    m.includes("abuse detection") ||
    m.includes("too many requests")
  );
}

function rateLimitRemainingIsZero(
  headers: Record<string, string> | undefined,
): boolean {
  const raw = headerGet(headers, "x-ratelimit-remaining");
  if (raw === undefined) return false;
  return String(raw).trim() === "0";
}

/**
 * True when this 403 is almost certainly GitHub REST primary/secondary rate limiting
 * or abuse throttling — not missing OAuth scopes / org access.
 *
 * Uses the JSON `message` field only (not {@link RequestError#message}), because Octokit
 * appends `documentation_url` to `error.message`, which can mention “rate limits” for
 * unrelated errors and mislead callers.
 */
export function isLikelyGitHubRateLimit403(error: RequestError): boolean {
  if (error.status !== 403) return false;
  const headers = error.response?.headers as Record<string, string> | undefined;
  const apiMsg = githubApiMessage(error.response?.data);
  if (github403BodyLooksLikePermissionDenied(apiMsg)) {
    return false;
  }
  if (github403BodyLooksLikeRateLimit(apiMsg)) {
    return true;
  }
  if (rateLimitRemainingIsZero(headers)) {
    return true;
  }
  return false;
}

/**
 * User-facing line when {@link isLikelyGitHubRateLimit403} is true — uses
 * `X-RateLimit-Reset` / `X-RateLimit-Limit` / `X-RateLimit-Resource` when GitHub sends them.
 */
export function userGitHubRestRateLimitShortMessage(error: RequestError): string {
  const headers = error.response?.headers as Record<string, string> | undefined;
  const resetRaw = headerGet(headers, "x-ratelimit-reset");
  const limitRaw = headerGet(headers, "x-ratelimit-limit");
  const resourceRaw = headerGet(headers, "x-ratelimit-resource");
  const resetSec = resetRaw ? Number.parseInt(String(resetRaw).trim(), 10) : NaN;

  const limitPart =
    limitRaw?.trim() && limitRaw.trim() !== "0"
      ? ` This sign-in is allowed ${limitRaw.trim()} REST requests per hour on GitHub’s “${resourceRaw?.trim() || "core"}” budget.`
      : "";

  if (Number.isFinite(resetSec) && resetSec > 1_000_000_000) {
    const whenUtc = new Date(resetSec * 1000).toUTCString();
    return `GitHub’s hourly REST API quota for this account is exhausted.${limitPart} It resets at ${whenUtc}. Use Retry or Refresh after that.`;
  }

  return `GitHub’s hourly REST API quota for this account is exhausted.${limitPart} Wait up to an hour, then use Retry or Refresh.`;
}

const ACCESS_LABEL: Record<string, string> = {
  read: "Read-only",
  write: "Read and write",
  admin: "Administration",
};

/** Slugs from `X-Accepted-GitHub-Permissions` → GitHub App settings labels (Repository / Organization). */
const PERM_SLUG_LABELS: Record<string, { section: "Repository" | "Organization"; label: string }> = {
  metadata: { section: "Repository", label: "Metadata" },
  contents: { section: "Repository", label: "Contents" },
  secrets: { section: "Repository", label: "Secrets (Actions)" },
  variables: { section: "Repository", label: "Variables (Actions)" },
  actions: { section: "Repository", label: "Actions" },
  workflows: { section: "Repository", label: "Workflows" },
  administration: { section: "Repository", label: "Administration" },
  issues: { section: "Repository", label: "Issues" },
  pull_requests: { section: "Repository", label: "Pull requests" },
  members: { section: "Organization", label: "Members" },
  administration_org: { section: "Organization", label: "Administration" },
};

function formatSlugLabel(slug: string): { section: "Repository" | "Organization"; label: string } {
  const mapped = PERM_SLUG_LABELS[slug];
  if (mapped) return mapped;
  const words = slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { section: "Repository", label: words };
}

function formatPair(slug: string, access: string): string {
  const accessLabel = ACCESS_LABEL[access] ?? access;
  const { section, label } = formatSlugLabel(slug);
  return `${section} permissions → ${label}: ${accessLabel}`;
}

/**
 * Parses `X-Accepted-GitHub-Permissions` per GitHub docs: comma = AND within an option,
 * semicolon = OR between alternative permission sets.
 * @see https://docs.github.com/en/rest/overview/troubleshooting-the-rest-api#resource-not-accessible
 */
export function humanLinesFromAcceptedGitHubPermissions(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const alternatives = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return alternatives.map((alt, idx) => {
    const pairs = alt
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return pair;
        const slug = pair.slice(0, eq).trim();
        const access = pair.slice(eq + 1).trim();
        if (!slug || !access) return pair;
        return formatPair(slug, access);
      });
    const joined = pairs.join(" + ");
    if (alternatives.length === 1) {
      return `GitHub App needs: ${joined}`;
    }
    return `Alternative ${idx + 1} (all of): ${joined}`;
  });
}

/** Classic OAuth / PAT: scopes GitHub says would have worked. */
export function humanLineFromAcceptedOAuthScopes(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  return `OAuth scopes GitHub accepted for this endpoint: ${raw.trim()}`;
}

export type Forbidden403Hints = {
  missingPermissionLines: string[];
  githubApiMessage?: string;
  rawAcceptedGitHubPermissions?: string;
  rawAcceptedOAuthScopes?: string;
};

export function forbidden403HintsFromRequestError(error: RequestError): Forbidden403Hints {
  const headers = error.response?.headers as Record<string, string> | undefined;
  const rawGh = headerGet(headers, "x-accepted-github-permissions");
  const rawOAuth = headerGet(headers, "x-accepted-oauth-scopes");
  const lines = [...humanLinesFromAcceptedGitHubPermissions(rawGh)];
  const oauthLine = humanLineFromAcceptedOAuthScopes(rawOAuth);
  if (oauthLine) lines.push(oauthLine);
  return {
    missingPermissionLines: lines,
    githubApiMessage: githubApiMessage(error.response?.data),
    rawAcceptedGitHubPermissions: rawGh?.trim() || undefined,
    rawAcceptedOAuthScopes: rawOAuth?.trim() || undefined,
  };
}
