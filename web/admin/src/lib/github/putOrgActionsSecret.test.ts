import { describe, it, expect, vi } from "vitest";
import type { Octokit } from "@octokit/rest";
import { putOrgActionsSecret } from "./putOrgActionsSecret";

vi.mock("libsodium-wrappers", () => {
  const fill = (n: number, b: number) => {
    const a = new Uint8Array(n);
    a.fill(b);
    return a;
  };
  return {
    default: {
      ready: Promise.resolve(),
      from_string: (s: string) => new TextEncoder().encode(s),
      from_base64: () => fill(32, 2),
      crypto_box_seal: () => fill(80, 3),
      to_base64: () => "ZW5j",
      base64_variants: { ORIGINAL: 1 },
    },
  };
});

describe("putOrgActionsSecret", () => {
  it("GET public key then PUT org secret with sealed payload", async () => {
    const request = vi.fn().mockImplementation(async (route: string) => {
      if (route === "GET /orgs/{org}/actions/secrets/public-key") {
        return {
          data: {
            key_id: "kid-1",
            key: btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 9))),
          },
        };
      }
      if (route === "PUT /orgs/{org}/actions/secrets/{secret_name}") {
        return { status: 201, data: {} };
      }
      throw new Error(`unexpected route ${route}`);
    });
    const octokit = { request } as unknown as Octokit;
    await putOrgActionsSecret(octokit, "acme", "FULLSEND_DISPATCH_TOKEN", " ghp_test ", [42, 43]);
    expect(request).toHaveBeenCalledTimes(2);
    const putArgs = request.mock.calls[1]![1] as {
      org: string;
      secret_name: string;
      encrypted_value: string;
      key_id: string;
      visibility: string;
      selected_repository_ids: number[];
    };
    expect(putArgs.org).toBe("acme");
    expect(putArgs.secret_name).toBe("FULLSEND_DISPATCH_TOKEN");
    expect(putArgs.key_id).toBe("kid-1");
    expect(putArgs.visibility).toBe("selected");
    expect(putArgs.selected_repository_ids).toEqual([42, 43]);
    expect(putArgs.encrypted_value).toBe("ZW5j");
  });
});
