<script lang="ts">
  import { get } from "svelte/store";
  import { RequestError } from "@octokit/request-error";
  import { githubUser } from "../lib/auth/session";
  import { loadToken } from "../lib/auth/tokenStore";
  import { createUserOctokit } from "../lib/github/client";
  import { analyzeOrgLayers } from "../lib/layers/analyzeOrg";
  import {
    CONFIG_FILE_PATH,
    CONFIG_REPO_NAME,
    SHIM_WORKFLOW_PATH,
  } from "../lib/layers/constants";
  import { createLayerGithub } from "../lib/layers/githubClient";
  import {
    agentsFromConfig,
    enabledReposFromConfig,
    parseOrgConfigYaml,
    validateOrgConfig,
    type OrgConfigYaml,
  } from "../lib/layers/orgConfigParse";
  import type { LayerStatus } from "../lib/status/types";
  import {
    classifyRepoUnionKind,
    filterRepoNamesBySearch,
    isRepoEnabledInConfig,
    repoNamesFromOrgConfig,
    sortedUnionRepoNames,
  } from "../lib/repos/unionConfig";

  let { params = { org: "" } }: { params?: { org?: string } } = $props();
  const org = $derived(decodeURIComponent((params?.org ?? "").trim()));

  const DISPLAY_CAP = 15;

  let loadGen = 0;
  let loadAbort: AbortController | null = null;
  let rowResolveAbort: AbortController | null = null;

  let pageError = $state<string | null>(null);
  let orgMetaLoading = $state(true);
  let orgDisplayName = $state<string | null>(null);
  let orgAvatarUrl = $state<string | null>(null);

  let unionAll = $state<string[]>([]);
  let githubNameSet = $state<Set<string>>(new Set());
  let configNameSet = $state<Set<string>>(new Set());
  let parsedConfig = $state<OrgConfigYaml | null>(null);
  let configValidateError = $state<string | null>(null);

  let rollupStatus = $state<LayerStatus | null>(null);
  let layersLoading = $state(true);
  let layersError = $state<string | null>(null);

  let search = $state("");
  let listLoading = $state(true);

  type RepoRowUi =
    | { kind: "loading" }
    | { kind: "R6" }
    | { kind: "R7" }
    | { kind: "R1" }
    | { kind: "R4" }
    | { kind: "config_disabled" }
    | { kind: "row_error"; message: string };

  let rowUi = $state<Record<string, RepoRowUi>>({});

  const filteredUnion = $derived(filterRepoNamesBySearch(unionAll, search));
  const displayedRepos = $derived(filteredUnion.slice(0, DISPLAY_CAP));
  const showRepoCapHint = $derived(filteredUnion.length > DISPLAY_CAP);

  function orgGravatarFallback(login: string): string {
    return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  }

  function safePopoverToken(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  async function resolveRepoRows(
    names: string[],
    orgName: string,
    cfg: OrgConfigYaml | null,
    ghSet: ReadonlySet<string>,
    cfgSet: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const token = loadToken()?.accessToken;
    const next: Record<string, RepoRowUi> = {};

    if (!token) {
      for (const n of names) {
        next[n] = { kind: "row_error", message: "Not signed in." };
      }
      rowUi = next;
      return;
    }

    if (!cfg) {
      for (const n of names) {
        const k = classifyRepoUnionKind(n, ghSet, cfgSet);
        if (k === "github_only") next[n] = { kind: "R6" };
        else if (k === "config_only") next[n] = { kind: "R7" };
        else next[n] = { kind: "config_disabled" };
      }
      rowUi = next;
      return;
    }

    const octokit = createUserOctokit(token);
    const gh = createLayerGithub(octokit);

    for (const name of names) {
      if (signal.aborted) return;
      const k = classifyRepoUnionKind(name, ghSet, cfgSet);
      if (k === "github_only") {
        next[name] = { kind: "R6" };
        continue;
      }
      if (k === "config_only") {
        next[name] = { kind: "R7" };
        continue;
      }
      if (!isRepoEnabledInConfig(cfg, name)) {
        next[name] = { kind: "config_disabled" };
        continue;
      }
      next[name] = { kind: "loading" };
      rowUi = { ...next };
      try {
        const body = await gh.getRepoFileUtf8(orgName, name, SHIM_WORKFLOW_PATH);
        if (signal.aborted) return;
        next[name] = { kind: body !== null ? "R4" : "R1" };
      } catch (e) {
        if (signal.aborted) return;
        next[name] = {
          kind: "row_error",
          message: e instanceof Error ? e.message : "Failed to evaluate repository.",
        };
      }
      rowUi = { ...next };
    }
  }

  async function loadDashboard(): Promise<void> {
    const gen = (loadGen += 1);
    loadAbort?.abort();
    rowResolveAbort?.abort();
    loadAbort = new AbortController();
    const signal = loadAbort.signal;

    pageError = null;
    configValidateError = null;
    layersError = null;
    orgMetaLoading = true;
    listLoading = true;
    layersLoading = true;
    rollupStatus = null;
    unionAll = [];
    githubNameSet = new Set();
    configNameSet = new Set();
    parsedConfig = null;
    rowUi = {};

    const token = loadToken()?.accessToken;
    if (!token || !org) {
      pageError = !org ? "Missing organisation." : "Sign in to load this organisation.";
      orgMetaLoading = false;
      listLoading = false;
      layersLoading = false;
      return;
    }

    const octokit = createUserOctokit(token);
    const gh = createLayerGithub(octokit);

    try {
      const { data } = await octokit.orgs.get({ org });
      if (signal.aborted || gen !== loadGen) return;
      orgDisplayName = data.name ?? null;
      orgAvatarUrl = data.avatar_url ?? orgGravatarFallback(org);
    } catch (e) {
      if (signal.aborted || gen !== loadGen) return;
      if (e instanceof RequestError && e.status === 404) {
        pageError = "Organisation not found or you do not have access.";
      } else {
        pageError =
          e instanceof Error ? e.message : "Failed to load organisation metadata.";
      }
      orgMetaLoading = false;
      listLoading = false;
      layersLoading = false;
      return;
    }
    orgMetaLoading = false;

    const githubNames: string[] = [];
    try {
      for await (const res of octokit.paginate.iterator(
        octokit.repos.listForOrg,
        { org, per_page: 100, type: "all" },
      )) {
        if (signal.aborted || gen !== loadGen) return;
        for (const r of res.data) {
          if (r.name && r.name !== CONFIG_REPO_NAME) {
            githubNames.push(r.name);
          }
        }
      }
    } catch (e) {
      if (signal.aborted || gen !== loadGen) return;
      pageError =
        e instanceof Error ? e.message : "Failed to list organisation repositories.";
      listLoading = false;
      layersLoading = false;
      return;
    }

    const githubSet = new Set(githubNames);
    let cfg: OrgConfigYaml | null = null;
    const rawConfig = await gh.getRepoFileUtf8(org, CONFIG_REPO_NAME, CONFIG_FILE_PATH);
    if (signal.aborted || gen !== loadGen) return;

    if (rawConfig !== null) {
      try {
        cfg = parseOrgConfigYaml(rawConfig);
        const verr = validateOrgConfig(cfg);
        if (verr) {
          configValidateError = verr;
          cfg = null;
        }
      } catch (e) {
        configValidateError =
          e instanceof Error ? e.message : "config.yaml could not be parsed.";
        cfg = null;
      }
    }

    parsedConfig = cfg;
    const configRepoNames = cfg ? repoNamesFromOrgConfig(cfg) : [];
    const cfgSet = new Set(configRepoNames);
    githubNameSet = githubSet;
    configNameSet = cfgSet;
    unionAll = sortedUnionRepoNames(githubNames, configRepoNames);
    listLoading = false;

    if (cfg) {
      try {
        const { rollup } = await analyzeOrgLayers({
          org,
          gh,
          agents: agentsFromConfig(cfg),
          enabledRepos: enabledReposFromConfig(cfg),
        });
        if (signal.aborted || gen !== loadGen) return;
        rollupStatus = rollup;
      } catch (e) {
        if (signal.aborted || gen !== loadGen) return;
        layersError =
          e instanceof Error ? e.message : "Failed to analyze Fullsend deployment status.";
        rollupStatus = "unknown";
      }
    } else {
      rollupStatus = "not_installed";
    }
    layersLoading = false;
  }

  /** Load org dashboard whenever `org` or signed-in user changes. */
  $effect(() => {
    const o = org;
    const unsub = githubUser.subscribe((u) => {
      if (!o) {
        pageError = "Missing organisation.";
        orgMetaLoading = false;
        listLoading = false;
        layersLoading = false;
        return;
      }
      if (!u) {
        loadAbort?.abort();
        rowResolveAbort?.abort();
        pageError = "Sign in to load this organisation.";
        unionAll = [];
        rollupStatus = null;
        listLoading = false;
        layersLoading = false;
        orgMetaLoading = false;
        rowUi = {};
        return;
      }
      void loadDashboard();
    });
    return () => {
      unsub();
      loadAbort?.abort();
      rowResolveAbort?.abort();
    };
  });

  /** Resolve repo row UI for the current search slice after data loads. */
  $effect(() => {
    const o = org;
    const loading = listLoading;
    const err = pageError;
    const slice = displayedRepos;
    const cfg = parsedConfig;
    const ghS = githubNameSet;
    const cS = configNameSet;

    if (!o || loading || err || slice.length === 0) return;
    if (!get(githubUser)) return;

    rowResolveAbort?.abort();
    rowResolveAbort = new AbortController();
    const sig = rowResolveAbort.signal;
    void resolveRepoRows(slice, o, cfg, ghS, cS, sig);

    return () => rowResolveAbort?.abort();
  });

  async function retryRow(name: string): Promise<void> {
    const token = loadToken()?.accessToken;
    if (!token) return;
    const cfg = parsedConfig;
    if (!cfg || !isRepoEnabledInConfig(cfg, name)) return;
    const octokit = createUserOctokit(token);
    const gh = createLayerGithub(octokit);
    rowUi = { ...rowUi, [name]: { kind: "loading" } };
    try {
      const body = await gh.getRepoFileUtf8(org, name, SHIM_WORKFLOW_PATH);
      rowUi = { ...rowUi, [name]: { kind: body !== null ? "R4" : "R1" } };
    } catch (e) {
      rowUi = {
        ...rowUi,
        [name]: {
          kind: "row_error",
          message: e instanceof Error ? e.message : "Failed to evaluate repository.",
        },
      };
    }
  }
</script>

<section class="dash" aria-labelledby="dash-title">
  <nav class="crumb" aria-label="Breadcrumb">
    <a class="crumb-link" href="#/orgs">Organisations</a>
    <span class="crumb-sep" aria-hidden="true">/</span>
    <span class="crumb-current">{org}</span>
  </nav>

  <div class="org-context">
    {#if orgMetaLoading}
      <div class="org-context-spinner" aria-hidden="true"></div>
    {:else if orgAvatarUrl}
      <img
        class="org-context-avatar"
        src={orgAvatarUrl}
        alt=""
        width="40"
        height="40"
      />
    {/if}
    <div class="org-context-text">
      <span class="org-context-login">{org}</span>
      {#if orgDisplayName && orgDisplayName !== org}
        <span class="org-context-name">{orgDisplayName}</span>
      {/if}
    </div>
  </div>

  <h1 id="dash-title">Organisation dashboard</h1>

  {#if pageError}
    <div class="banner banner--err" role="alert">
      <span class="banner-msg">{pageError}</span>
      <a class="btn banner-action" href="#/orgs">Back to list</a>
    </div>
  {:else}
    {#if configValidateError}
      <div class="banner banner--err" role="alert">
        <span class="banner-msg">config.yaml is invalid: {configValidateError}</span>
      </div>
    {/if}

    {#if layersError}
      <div class="banner banner--err" role="alert">
        <span class="banner-msg">{layersError}</span>
        <button type="button" class="btn banner-retry" onclick={() => void loadDashboard()}>
          Retry
        </button>
      </div>
    {/if}

    <section class="pane pane-a" aria-labelledby="pane-a-h">
      <h2 id="pane-a-h" class="pane-title">Fullsend status:</h2>
      {#if layersLoading}
        <div class="status-line" role="status" aria-live="polite" aria-busy="true">
          <span class="row-spinner-disc" aria-hidden="true"></span>
          <span>Checking</span>
        </div>
      {:else if rollupStatus === "installed"}
        <div class="status-line">
          <span class="status-dot status-dot--ok" aria-hidden="true"></span>
          <span>Deployed</span>
          <button type="button" class="btn" disabled title="Coming in a later task">Upgrade</button>
          <button type="button" class="btn" disabled title="Coming in a later task">Repair</button>
        </div>
      {:else if rollupStatus === "degraded"}
        <div class="status-line">
          <span class="status-warn" aria-hidden="true">▲</span>
          <span>Partially deployed / broken</span>
          <button type="button" class="btn" disabled title="Coming in a later task">Repair</button>
        </div>
      {:else if rollupStatus === "not_installed"}
        <div class="status-line">
          <span class="status-warn" aria-hidden="true">▲</span>
          <span>Partially deployed / broken</span>
          <button type="button" class="btn" disabled title="Coming in a later task">Repair</button>
        </div>
      {:else if rollupStatus === "unknown"}
        <div class="status-line">
          <span class="status-warn" aria-hidden="true">▲</span>
          <span>Partially deployed / broken</span>
          <button type="button" class="btn" disabled title="Coming in a later task">Repair</button>
        </div>
      {:else}
        <div class="status-line" role="status" aria-live="polite" aria-busy="true">
          <span class="row-spinner-disc" aria-hidden="true"></span>
          <span>Checking</span>
        </div>
      {/if}
    </section>

    <section class="pane pane-b" aria-labelledby="pane-b-h">
      <h2 id="pane-b-h" class="pane-title">Repositories</h2>
      <div class="toolbar">
        <label class="search-label">
          <span class="sr-only">Filter repositories</span>
          <input
            type="search"
            class="search"
            placeholder="Type to filter"
            bind:value={search}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <button
          type="button"
          class="btn"
          disabled={listLoading}
          onclick={() => void loadDashboard()}
        >
          Refresh
        </button>
      </div>

      {#if showRepoCapHint}
        <p class="cap-hint" role="status">Showing up to 15 repositories</p>
      {/if}

      {#if listLoading && unionAll.length === 0}
        <div class="org-loading" role="status" aria-live="polite" aria-busy="true">
          <div class="org-loading-spinner" aria-hidden="true"></div>
          <p class="org-loading-label">Loading repositories…</p>
        </div>
      {:else if displayedRepos.length === 0}
        <p class="muted">No matching repositories.</p>
      {:else}
        <ul class="list">
          {#each displayedRepos as name (name)}
            {@const ui = rowUi[name]}
            <li class="row">
              <div class="row-main">
                <span class="repo-name">{name}</span>
              </div>
              <div class="row-actions">
                {#if ui === undefined || ui.kind === "loading"}
                  <div
                    class="row-spinner"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    aria-label="Loading repository status"
                  >
                    <span class="row-spinner-disc" aria-hidden="true"></span>
                  </div>
                {:else if ui.kind === "R6"}
                  <span class="info-ico" aria-hidden="true">ⓘ</span>
                  <span class="trail-label">Not in Fullsend config</span>
                  <button type="button" class="btn btn-primary" disabled>Onboard</button>
                {:else if ui.kind === "R7"}
                  <span class="status-warn" aria-hidden="true">▲</span>
                  <span class="trail-label">Repository missing</span>
                  {@const oid = `orph-${safePopoverToken(name)}`}
                  <button
                    type="button"
                    class="info-btn info-btn--err"
                    popovertarget={oid}
                    aria-haspopup="dialog"
                    aria-label={`Why ${name} is missing from GitHub`}
                  >
                    i
                  </button>
                  <div id={oid} class="row-err-popover" popover>
                    <p class="row-err-popover-lead">
                      This name appears in config.yaml but no repository with that name is visible
                      for this organisation (deleted, renamed, or inaccessible).
                    </p>
                  </div>
                  <button type="button" class="btn btn-danger" disabled>Remove from config</button>
                {:else if ui.kind === "R1"}
                  <button type="button" class="btn btn-primary" disabled>Onboard</button>
                {:else if ui.kind === "R4"}
                  <span class="status-dot status-dot--ok" aria-hidden="true"></span>
                  <span class="trail-label">Onboarded</span>
                  <button type="button" class="btn btn-danger" disabled>Remove</button>
                {:else if ui.kind === "config_disabled"}
                  <span class="trail-muted">In config (not enabled)</span>
                  <button type="button" class="btn btn-primary" disabled>Onboard</button>
                {:else if ui.kind === "row_error"}
                  {@const eid = `re-${safePopoverToken(name)}`}
                  <div class="row-err">
                    <span class="err-icon" aria-hidden="true">▲</span>
                    <span class="row-err-label">Error</span>
                    <button
                      type="button"
                      class="info-btn info-btn--err"
                      popovertarget={eid}
                      aria-haspopup="dialog"
                      aria-label={`Technical details for ${name}`}
                    >
                      i
                    </button>
                    <div id={eid} class="row-err-popover" popover>
                      <p class="row-err-popover-lead">{ui.message}</p>
                    </div>
                    <button
                      type="button"
                      class="btn row-err-retry"
                      onclick={() => void retryRow(name)}
                    >
                      Retry
                    </button>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>

<style>
  .dash {
    max-width: 48rem;
  }
  .crumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.88rem;
    margin-bottom: 0.75rem;
  }
  .crumb-link {
    color: #0969da;
    text-decoration: none;
  }
  .crumb-link:hover {
    text-decoration: underline;
  }
  .crumb-sep {
    color: #57606a;
  }
  .crumb-current {
    font-weight: 600;
    color: #24292f;
  }
  .org-context {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .org-context-spinner {
    width: 2.5rem;
    height: 2.5rem;
    border: 3px solid #d0d7de;
    border-top-color: #24292f;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  .org-context-avatar {
    border-radius: 8px;
    object-fit: cover;
  }
  .org-context-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    line-height: 1.25;
  }
  .org-context-login {
    font-weight: 700;
    font-size: 1.05rem;
  }
  .org-context-name {
    font-size: 0.9rem;
    color: #57606a;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  #dash-title {
    margin: 0 0 1rem;
    font-size: 1.15rem;
    font-weight: 600;
  }
  .pane {
    margin-bottom: 1.75rem;
  }
  .pane-title {
    margin: 0 0 0.5rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    font-size: 0.95rem;
  }
  .status-dot {
    display: inline-block;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: #1a7f37;
  }
  .status-dot--ok {
    background: #1a7f37;
  }
  .status-warn {
    color: #9a6700;
    font-size: 0.85rem;
  }
  .row-spinner-disc {
    display: inline-block;
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid #d0d7de;
    border-top-color: #24292f;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .search-label {
    flex: 1;
    min-width: 12rem;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.6rem;
    font: inherit;
    border: 1px solid #ccc;
    border-radius: 6px;
  }
  .cap-hint {
    margin: 0 0 0.75rem;
    font-size: 0.88rem;
    color: #cf222e;
    font-weight: 500;
  }
  .btn {
    cursor: pointer;
    padding: 0.35rem 0.75rem;
    border: 1px solid #888;
    border-radius: 6px;
    background: #f4f4f4;
    font: inherit;
    font-size: 0.88rem;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .btn:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
  }
  .btn-primary {
    background: #0969da;
    border-color: #0969da;
    color: #fff;
  }
  .btn-danger {
    background: #fff;
    border-color: #cf222e;
    color: #a40e26;
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 1rem;
    padding: 0.65rem 0.75rem;
    margin: 0 0 1rem;
    border: 1px solid #ffc1c1;
    border-radius: 8px;
    background: #ffeef0;
    font-size: 0.92rem;
  }
  .banner-msg {
    flex: 1;
    min-width: 10rem;
    color: #24292f;
  }
  .banner-action {
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
  }
  .banner-retry {
    flex-shrink: 0;
  }

  .org-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
  }
  .org-loading-spinner {
    width: 2.25rem;
    height: 2.25rem;
    border: 3px solid #d0d7de;
    border-top-color: #24292f;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }
  .org-loading-label {
    margin: 0;
    color: #444;
  }
  .muted {
    color: #555;
  }

  .list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    border: 1px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #eee;
  }
  .row:last-child {
    border-bottom: none;
  }
  .row-main {
    min-width: 0;
  }
  .repo-name {
    font-size: 0.95rem;
    font-weight: 500;
    word-break: break-word;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    min-height: 2.25rem;
  }
  .row-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
  }
  .trail-label {
    font-size: 0.88rem;
    color: #24292f;
  }
  .trail-muted {
    font-size: 0.85rem;
    color: #57606a;
  }
  .info-ico {
    font-size: 0.85rem;
    color: #57606a;
  }
  .info-btn {
    box-sizing: border-box;
    min-width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border-radius: 999px;
    border: 1px solid #cf222e;
    background: #ffeef0;
    color: #a40e26;
    font-size: 0.72rem;
    font-weight: 700;
    font-style: italic;
    cursor: pointer;
    line-height: 1;
  }
  .info-btn:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
  }
  .info-btn--err {
    border-color: #cf222e;
  }
  .row-err-popover {
    max-width: min(22rem, calc(100vw - 2rem));
    padding: 0.75rem 0.85rem;
    border: 1px solid #f0b2b2;
    border-radius: 8px;
    background: #fff8f8;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    color: #24292f;
    font-size: 0.85rem;
    line-height: 1.45;
    word-break: break-word;
  }
  .row-err-popover-lead {
    margin: 0;
    font-weight: 500;
  }
  .row-err {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    max-width: 22rem;
    font-size: 0.85rem;
    color: #a40e26;
  }
  .err-icon {
    font-size: 0.75rem;
    line-height: 1;
  }
  .row-err-label {
    font-weight: 700;
  }
  .row-err-retry {
    padding: 0.25rem 0.5rem;
    font-size: 0.82rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
