import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildAgentAppManifestConfig,
  exchangeManifestCode,
  expectedAppSlug,
  githubAppInstallationsNewUrl,
  githubOrgNewAppUrl,
  submitAgentAppManifestSameWindow,
} from "./agentAppManifest";

describe("expectedAppSlug", () => {
  it("matches Go convention", () => {
    expect(expectedAppSlug("acme", "coder")).toBe("acme-coder");
  });
});

describe("buildAgentAppManifestConfig", () => {
  it("matches Go AgentAppConfig for coder", () => {
    const redirect = "http://127.0.0.1:9/callback";
    const cfg = buildAgentAppManifestConfig("myorg", "coder", redirect);
    expect(cfg.name).toBe("myorg-coder");
    expect(cfg.redirect_url).toBe(redirect);
    expect(cfg.default_permissions).toEqual({
      issues: "read",
      contents: "write",
      pull_requests: "write",
      checks: "read",
    });
    expect(cfg.default_events).toEqual([
      "issues",
      "issue_comment",
      "pull_request",
      "check_run",
      "check_suite",
    ]);
    expect(cfg.hook_attributes.active).toBe(false);
    expect(cfg.public).toBe(false);
  });

  it("builds org new-app URL", () => {
    expect(githubOrgNewAppUrl("my org")).toContain(encodeURIComponent("my org"));
  });

  it("builds install URL without query params", () => {
    expect(githubAppInstallationsNewUrl("acme-coder")).toBe(
      "https://github.com/apps/acme-coder/installations/new",
    );
  });
});

describe("exchangeManifestCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses successful conversion JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            id: 1,
            slug: "acme-coder",
            name: "acme-coder",
            pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n",
            client_id: "Iv1.abc",
            client_secret: "sec",
            html_url: "https://github.com/apps/acme-coder",
          }),
      })),
    );
    const r = await exchangeManifestCode("one-time-code");
    expect(r.slug).toBe("acme-coder");
    expect(r.pem).toContain("BEGIN RSA");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/app-manifests/one-time-code/conversions",
      expect.objectContaining({
        method: "POST",
        headers: { Accept: "application/vnd.github+json" },
      }),
    );
  });

  it("throws on GitHub error JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ message: "invalid code" }),
      })),
    );
    await expect(exchangeManifestCode("bad")).rejects.toThrow(/invalid code/);
  });
});

describe("submitAgentAppManifestSameWindow", () => {
  it("appends a POST form to the document and submits it", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const submitSpy = vi.fn();
    const proto = HTMLFormElement.prototype;
    const origSubmit = proto.submit;
    proto.submit = submitSpy;
    try {
      submitAgentAppManifestSameWindow(
        "acme",
        "coder",
        "https://example.test/admin/?fullsend_app_manifest=1",
      );
      expect(appendSpy).toHaveBeenCalledOnce();
      const form = appendSpy.mock.calls[0]![0] as HTMLFormElement;
      expect(form.method.toLowerCase()).toBe("post");
      expect(form.action).toContain("github.com/organizations/acme");
      expect(submitSpy).toHaveBeenCalledOnce();
    } finally {
      proto.submit = origSubmit;
      appendSpy.mockRestore();
    }
  });
});
