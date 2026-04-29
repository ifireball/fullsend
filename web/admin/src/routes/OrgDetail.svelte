<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { params as routeParams } from "svelte-spa-router";
  import { RequestError } from "@octokit/request-error";
  import { githubUser } from "../lib/auth/session";
  import { navOrgContext, setNavOrgContext } from "../lib/shell/navOrgContext";
  import { loadToken } from "../lib/auth/tokenStore";
  import { createUserOctokit } from "../lib/github/client";
  import { runRepoOnboard, type OnboardRowKind } from "../lib/enrollment/runRepoOnboard";
  import { analyzeOrgInstallRollupLayers } from "../lib/layers/analyzeOrg";
  import { CONFIG_FILE_PATH, CONFIG_REPO_NAME } from "../lib/layers/constants";
  import { createLayerGithub } from "../lib/layers/githubClient";
  import {
    agentsFromConfig,
    defaultFullsendAgentRows,
    parseOrgConfigYaml,
    validateOrgConfig,
    type OrgConfigYaml,
  } from "../lib/layers/orgConfigParse";
  import FullsendOrgDashboardCard from "../lib/orgSetup/FullsendOrgDashboardCard.svelte";
  import type { LayerReport } from "../lib/status/types";
  import { evaluateManagedRepoRowStatus } from "../lib/repos/managedRepoRowStatus";
  import {
    classifyRepoUnionKind,
    filterRepoNamesBySearch,
    isRepoEnabledInConfig,
    repoNamesFromOrgConfig,
    sortedUnionRepoNames,
  } from "../lib/repos/unionConfig";

  /**
   * Read the matched `:org` from the router store, not `$props().params`.
   * With Svelte 5 + `svelte-spa-router`, the same route component instance can be reused while
   * props stay stale; the store is updated on every match (see Router.svelte `params.set`).
   */
  const org = $derived(
    decodeURIComponent(String(($routeParams as { org?: string } | undefined)?.org ?? "").trim()),
  );

  const DISPLAY_CAP = 15;

  let loadGen = 0;
  let loadAbort: AbortController | null = null;
  let rowResolveAbort: AbortController | null = null;
  /** Coalesces repo-row `$effect` work to the next microtask so we never start resolves during a flush. */
  let repoRowKickEpoch = 0;

  let pageError = $state<string | null>(null);
  let orgDisplayName = $state<string | null>(null);
  let orgAvatarUrl = $state<string | null>(null);

  let unionAll = $state<string[]>([]);
  let githubNameSet = $state<Set<string>>(new Set());
  let configNameSet = $state<Set<string>>(new Set());
  let parsedConfig = $state<OrgConfigYaml | null>(null);
  let configValidateError = $state<string | null>(null);

  /** `.fullsend` install stack card (same signals as org setup, navigation-only). */
  let fullsendInstallPending = $state(true);
  let fullsendInstallError = $state<string | null>(null);
  let fullsendInstallReports = $state<LayerReport[] | null>(null);
  let fullsendAgentRoles = $state<string[]>([]);

  let search = $state("");
  let listLoading = $state(true);

  type RepoRowUi =
    | { kind: "loading" }
    | { kind: "R6" }
    | { kind: "R7" }
    | { kind: "R1" }
    | { kind: "R2"; prNumber: number; prUrl: string }
    | { kind: "R4" }
    | { kind: "config_disabled" }
    | { kind: "row_error"; message: string };

  let rowUi = $state<Record<string, RepoRowUi>>({});
  let onboardingRepo = $state<string | null>(null);

  const filteredUnion = $derived(filterRepoNamesBySearch(unionAll, search));
  const displayedRepos = $derived(filteredUnion.slice(0, DISPLAY_CAP));
  const showRepoCapHint = $derived(filteredUnion.length > DISPLAY_CAP);

  function orgGravatarFallback(login: string): string {
    return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  }

  function safePopoverToken(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  /**
   * Avoid `navOrgContext.set` during an `$effect` flush — that re-renders the shell (and Router)
   * while Svelte is still applying OrgDetail updates, which can wedge the tab (hash/state move but
   * no paint, buttons feel dead). Defer the actual store write to a microtask.
   */
  function applyNavOrgBarIfChanged(
    login: string,
    avatarUrl: string | null,
    displayName: string | null,
  ): void {
    const av = avatarUrl ?? null;
    const dn = displayName ?? null;
    queueMicrotask(() => {
      const cur = get(navOrgContext);
      if (
        cur !== null &&
        cur.login === login &&
        cur.avatarUrl === av &&
        (cur.displayName ?? null) === dn &&
        cur.setupFlow === undefined &&
        cur.orgClusterLinksToDashboard !== false
      ) {
        return;
      }
      setNavOrgContext({
        login,
        avatarUrl: av,
        displayName: dn,
        orgClusterLinksToDashboard: true,
      });
    });
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
      rowUi = { ...rowUi, ...next };
      return;
    }

    if (!cfg) {
      for (const n of names) {
        const k = classifyRepoUnionKind(n, ghSet, cfgSet);
        if (k === "github_only") next[n] = { kind: "R6" };
        else if (k === "config_only") next[n] = { kind: "R7" };
        else next[n] = { kind: "config_disabled" };
      }
      rowUi = { ...rowUi, ...next };
      return;
    }

    const octokit = createUserOctokit(token);
    const gh = createLayerGithub(octokit);

    /**
     * Never assign `rowUi = { ...next }` mid-loop before every `name` in `names` has a row:
     * otherwise repos later in sort order lose their keys and render as undefined → endless spinner
     * until earlier `getRepoFileUtf8` awaits finish (or forever if one hangs).
     */
    const needShim: string[] = [];
    for (const name of names) {
      if (signal.aborted) return;
      const k = classifyRepoUnionKind(name, ghSet, cfgSet);
      if (k === "github_only") {
        next[name] = { kind: "R6" };
      } else if (k === "config_only") {
        next[name] = { kind: "R7" };
      } else if (!isRepoEnabledInConfig(cfg, name)) {
        next[name] = { kind: "config_disabled" };
      } else {
        next[name] = { kind: "loading" };
        needShim.push(name);
      }
    }
    rowUi = { ...rowUi, ...next };

    for (const name of needShim) {
      if (signal.aborted) return;
      const resolved = await evaluateManagedRepoRowStatus(orgName, name, gh, octokit, signal);
      if (signal.aborted) return;
      next[name] = resolved;
      rowUi = { ...rowUi, ...next };
    }
  }

  async function onboardRepo(repoName: string, rowKind: OnboardRowKind): Promise<void> {
    const token = loadToken()?.accessToken;
    const cfg = parsedConfig;
    if (!token || !org) return;
    if ((rowKind === "R6" || rowKind === "config_disabled") && !cfg) return;

    onboardingRepo = repoName;
    rowUi = { ...rowUi, [repoName]: { kind: "loading" } };
    try {
      const octokit = createUserOctokit(token);
      if (!cfg) {
        throw new Error(
          "No Fullsend configuration is loaded. Ensure the .fullsend repository has a valid config.yaml.",
        );
      }
      const pr = await runRepoOnboard({
        octokit,
        org,
        repoName,
        parsedConfig: cfg,
        rowKind,
      });
      rowUi = {
        ...rowUi,
        [repoName]: { kind: "R2", prNumber: pr.number, prUrl: pr.html_url },
      };
      void loadDashboard();
    } catch (e) {
      rowUi = {
        ...rowUi,
        [repoName]: {
          kind: "row_error",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    } finally {
      onboardingRepo = null;
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
    fullsendInstallError = null;
    fullsendInstallReports = null;
    fullsendInstallPending = true;
    fullsendAgentRoles = [];
    orgDisplayName = null;
    orgAvatarUrl = null;
    listLoading = true;
    unionAll = [];
    githubNameSet = new Set();
    configNameSet = new Set();
    parsedConfig = null;
    rowUi = {};

    const token = loadToken()?.accessToken;
    if (!token || !org) {
      pageError = !org ? "Missing organisation." : "Sign in to load this organisation.";
      listLoading = false;
      fullsendInstallPending = false;
      setNavOrgContext(null);
      return;
    }

    /** Breadcrumb: org slug + placeholder avatar until `orgs.get` returns. */
    applyNavOrgBarIfChanged(org, orgGravatarFallback(org), null);

    const octokit = createUserOctokit(token);
    const gh = createLayerGithub(octokit);

    try {
      try {
        const { data } = await octokit.orgs.get({ org });
        if (signal.aborted || gen !== loadGen) return;
        orgDisplayName = data.name ?? null;
        orgAvatarUrl = data.avatar_url ?? orgGravatarFallback(org);
        applyNavOrgBarIfChanged(
          org,
          orgAvatarUrl ?? orgGravatarFallback(org),
          orgDisplayName,
        );
      } catch (e) {
        if (signal.aborted || gen !== loadGen) return;
        if (e instanceof RequestError && e.status === 404) {
          pageError = "Organisation not found or you do not have access.";
        } else {
          pageError =
            e instanceof Error ? e.message : "Failed to load organisation metadata.";
        }
        listLoading = false;
        applyNavOrgBarIfChanged(org, orgGravatarFallback(org), null);
        return;
      }

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
      configNameSet = cfgSet;

      /**
       * Install rollup only touches `.fullsend` + org secret — run it **before** listing every
       * org repo (pagination can be huge and would keep `fullsendInstallPending` true forever).
       */
      fullsendInstallError = null;
      fullsendInstallReports = null;
      try {
        const agentsForAnalyze = cfg ? agentsFromConfig(cfg) : defaultFullsendAgentRows();
        fullsendAgentRoles = [...new Set(agentsForAnalyze.map((a) => a.role))].sort();
        const { reports } = await analyzeOrgInstallRollupLayers({
          org,
          gh,
          agents: agentsForAnalyze,
        });
        if (signal.aborted || gen !== loadGen) return;
        fullsendInstallReports = reports;
      } catch (e) {
        if (signal.aborted || gen !== loadGen) return;
        fullsendInstallError =
          e instanceof Error ? e.message : "Failed to load .fullsend install status.";
      }
      /** End “checking” as soon as install rollup returns — do not wait for full org repo pagination. */
      if (gen === loadGen) {
        fullsendInstallPending = false;
      }

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
        return;
      }

      const githubSet = new Set(githubNames);
      githubNameSet = githubSet;
      unionAll = sortedUnionRepoNames(githubNames, configRepoNames);
      listLoading = false;
    } finally {
      if (gen === loadGen) {
        if (listLoading) {
          listLoading = false;
        }
        fullsendInstallPending = false;
      }
    }
  }

  /**
   * Drive `loadDashboard` from reactive `org` + `$githubUser` only — **not** nested
   * `githubUser.subscribe` inside an `$effect`, which re-subscribed on unrelated parent re-renders
   * and aborted in-flight work (nav bar updates were enough to wedge the tab).
   */
  $effect(() => {
    const o = org;
    const u = $githubUser;
    if (!o) {
      pageError = "Missing organisation.";
      listLoading = false;
      fullsendInstallPending = false;
      setNavOrgContext(null);
      return;
    }
    if (!u) {
      loadAbort?.abort();
      rowResolveAbort?.abort();
      pageError = "Sign in to load this organisation.";
      unionAll = [];
      listLoading = false;
      fullsendInstallPending = false;
      fullsendInstallError = null;
      fullsendInstallReports = null;
      fullsendAgentRoles = [];
      rowUi = {};
      setNavOrgContext(null);
      return;
    }
    void loadDashboard();
    return () => {
      loadAbort?.abort();
      rowResolveAbort?.abort();
    };
  });

  /** Resolve repo row UI for the current search slice after data loads. */
  $effect(() => {
    const o = org;
    const loading = listLoading;
    const err = pageError;
    const all = unionAll;
    const q = search;
    const cfg = parsedConfig;
    const ghS = githubNameSet;
    const cS = configNameSet;

    if (!o || loading || err) return;
    /** `$githubUser` so this effect re-runs when the store hydrates — matches OrgList.svelte. */
    if (!$githubUser) return;

    const slice = filterRepoNamesBySearch(all, q).slice(0, DISPLAY_CAP);
    if (slice.length === 0) return;

    const epoch = ++repoRowKickEpoch;
    queueMicrotask(() => {
      if (epoch !== repoRowKickEpoch) return;
      const o2 = org;
      if (!o2 || listLoading || pageError || !get(githubUser)) return;
      const slice2 = filterRepoNamesBySearch(unionAll, search).slice(0, DISPLAY_CAP);
      if (slice2.length === 0) return;
      rowResolveAbort?.abort();
      rowResolveAbort = new AbortController();
      void resolveRepoRows(
        slice2,
        o2,
        parsedConfig,
        githubNameSet,
        configNameSet,
        rowResolveAbort.signal,
      );
    });

    return () => {
      repoRowKickEpoch += 1;
      rowResolveAbort?.abort();
    };
  });

  onMount(() => {
    return () => setNavOrgContext(null);
  });

  async function retryRow(name: string): Promise<void> {
    const token = loadToken()?.accessToken;
    if (!token || !org) return;
    const ac = new AbortController();
    await resolveRepoRows(
      [name],
      org,
      parsedConfig,
      githubNameSet,
      configNameSet,
      ac.signal,
    );
  }
</script>

<section class="dash" aria-labelledby="dash-title">
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

    <section class="pane pane-a" aria-labelledby="pane-a-h">
      <h2 id="pane-a-h" class="pane-title">Fullsend status</h2>
      <FullsendOrgDashboardCard
        {org}
        pending={fullsendInstallPending}
        error={fullsendInstallError}
        reports={fullsendInstallReports}
        roles={fullsendAgentRoles}
        onRetry={() => void loadDashboard()}
      />
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
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={onboardingRepo !== null || parsedConfig === null}
                    onclick={() => void onboardRepo(name, "R6")}
                  >
                    Onboard
                  </button>
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
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={onboardingRepo !== null}
                    onclick={() => void onboardRepo(name, "R1")}
                  >
                    Onboard
                  </button>
                {:else if ui.kind === "R2"}
                  <span class="status-dot status-dot--pending" aria-hidden="true"></span>
                  <span class="trail-label">
                    Onboarding — check <a
                      class="pr-link"
                      href={ui.prUrl}
                      target="_blank"
                      rel="noopener noreferrer">PR #{ui.prNumber}</a>
                  </span>
                {:else if ui.kind === "R4"}
                  <span class="status-dot status-dot--ok" aria-hidden="true"></span>
                  <span class="trail-label">Onboarded</span>
                  <button type="button" class="btn btn-danger" disabled>Remove</button>
                {:else if ui.kind === "config_disabled"}
                  <span class="trail-muted">In config (not enabled)</span>
                  <button
                    type="button"
                    class="btn btn-primary"
                    disabled={onboardingRepo !== null}
                    onclick={() => void onboardRepo(name, "config_disabled")}
                  >
                    Onboard
                  </button>
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
  .status-dot--pending {
    background: #9a6700;
  }
  .pr-link {
    color: #0969da;
    font-weight: 600;
    text-decoration: underline;
  }
  .pr-link:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
    border-radius: 2px;
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
  a.btn {
    text-decoration: none;
    color: inherit;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
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
