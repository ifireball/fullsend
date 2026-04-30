import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../github/client", () => ({
  createUserOctokit: vi.fn(),
}));

import { createUserOctokit } from "../github/client";
import {
  clearOrgListMemoryCache,
  fetchOrgs,
  fetchOrgsWithProgress,
  FetchOrgsError,
} from "./fetchOrgs";

function mockOctokit(iterator: () => AsyncIterableIterator<unknown>) {
  vi.mocked(createUserOctokit).mockReturnValue({
    paginate: {
      iterator: vi.fn(iterator),
    },
    rest: {
      apps: {
        listInstallationsForAuthenticatedUser: {},
      },
    },
  } as never);
}

describe("fetchOrgs (installations)", () => {
  beforeEach(() => {
    clearOrgListMemoryCache();
    vi.mocked(createUserOctokit).mockReset();
  });

  it("maps Organization installations and returns appSlugFromApi", async () => {
    mockOctokit(() =>
      (async function* () {
        yield {
          status: 200,
          data: {
            installations: [
              {
                id: 1,
                app_slug: "fullsend-app",
                account: { login: "zebra", type: "Organization" },
              },
              {
                id: 2,
                app_slug: "fullsend-app",
                account: { login: "alpha", type: "Organization" },
              },
            ],
          },
        };
      })(),
    );

    const r = await fetchOrgs("token", { force: true });
    expect(r.orgs.map((o) => o.login)).toEqual(["alpha", "zebra"]);
    expect(r.emptyHint).toBeNull();
    expect(r.appSlugFromApi).toBe("fullsend-app");
  });

  it("returns emptyHint when no org installations", async () => {
    mockOctokit(() =>
      (async function* () {
        yield {
          status: 200,
          data: {
            installations: [
              { id: 1, account: { login: "alice", type: "User" } },
            ],
          },
        };
      })(),
    );

    const r = await fetchOrgs("token", { force: true });
    expect(r.orgs).toEqual([]);
    expect(r.emptyHint).toBeTruthy();
    expect(r.appSlugFromApi).toBeNull();
  });

  it("throws FetchOrgsError for 403", async () => {
    mockOctokit(() =>
      (async function* () {
        throw Object.assign(new Error("Forbidden"), { status: 403 });
      })(),
    );

    await expect(fetchOrgs("token", { force: true })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof FetchOrgsError &&
        e.status === 403 &&
        e.message.includes("403"),
    );
  });

  it("throws AbortError when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();

    mockOctokit(() =>
      (async function* () {
        yield { status: 200, data: { installations: [] } };
      })(),
    );

    await expect(
      fetchOrgs("token", { force: true, signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls onProgress with installationPagesFetched", async () => {
    mockOctokit(() =>
      (async function* () {
        yield {
          status: 200,
          data: {
            installations: [
              { account: { login: "a", type: "Organization" }, app_slug: "x" },
            ],
          },
        };
        yield {
          status: 200,
          data: {
            installations: [
              { account: { login: "b", type: "Organization" }, app_slug: "x" },
            ],
          },
        };
      })(),
    );

    const metas: { done: boolean; installationPagesFetched: number }[] = [];
    await fetchOrgsWithProgress("token", {
      force: true,
      onProgress: (_orgs, meta) => {
        metas.push({ ...meta });
      },
    });

    expect(metas.length).toBeGreaterThanOrEqual(2);
    expect(metas.at(-1)?.done).toBe(true);
    expect(metas.at(-1)?.installationPagesFetched).toBe(2);
  });
});
