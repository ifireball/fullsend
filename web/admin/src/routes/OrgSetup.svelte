<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { RequestError } from "@octokit/request-error";
  import { githubUser } from "../lib/auth/session";
  import { setNavOrgContext } from "../lib/shell/navOrgContext";
  import { loadToken } from "../lib/auth/tokenStore";
  import { createUserOctokit } from "../lib/github/client";
  import { analyzeOrgLayers } from "../lib/layers/analyzeOrg";
  import {
    analyzeConfigRepoLayer,
    configRepoIsGreenfieldDeploy,
  } from "../lib/layers/configRepo";
  import {
    CONFIG_FILE_PATH,
    CONFIG_REPO_NAME,
  } from "../lib/layers/constants";
  import { createLayerGithub } from "../lib/layers/githubClient";
  import {
    agentsFromConfig,
    DEFAULT_FULLSEND_ORG_AGENT_ROLES,
    defaultFullsendAgentRows,
    enabledReposFromConfig,
    parseOrgConfigYaml,
    validateOrgConfig,
    type OrgConfigYaml,
  } from "../lib/layers/orgConfigParse";
  import {
    buildOrgSetupGroups,
    setupBoardTitlesFromAgents,
  } from "../lib/orgSetup/mapAnalyzeToGroups";
  import type { SetupGroupViewModel } from "../lib/orgSetup/types";
  import {
    githubAppInstallationsNewUrl,
    submitAgentAppManifestSameWindow,
  } from "../lib/actions/agentAppManifest";
  import {
    getGithubAppManifestRedirectUri,
    MANIFEST_POST_RESULT_KEY,
    stashManifestReturnContext,
  } from "../lib/auth/oauth";

  let { params = { org: "" } }: { params?: { org?: string } } = $props();
  const org = $derived(decodeURIComponent((params?.org ?? "").trim()));

  let loadGen = 0;
  /** Nested recheck calls; spinner clears when the last one finishes. */
  let recheckBusy = 0;
  let loadAbort: AbortController | null = null;

  let pageError = $state<string | null>(null);
  let orgDisplayName = $state<string | null>(null);
  let orgAvatarUrl = $state<string | null>(null);

  let parsedConfig = $state<OrgConfigYaml | null>(null);
  let configValidateError = $state<string | null>(null);
  let analyzeError = $state<string | null>(null);
  /** From manifest handoff when conversion fails. */
  let manifestFlowError = $state<string | null>(null);
  let analyzePending = $state(true);
  /** Card titles while `analyzePending` (set once agents list is known). */
  let pendingBoardTitles = $state<string[]>([]);
  let groups = $state<SetupGroupViewModel[]>([]);
  /** Drives nav bar "Deploy" vs "Repair" cluster after org; set after config-repo probe. */
  let setupFlow = $state<"deploy" | "repair" | null>(null);
  /** True when config-repo layer is not installed (org list would branch to Deploy). */
  let greenfieldDeploy = $state(false);
  /** True while a lightweight refresh (re-run analyse + setup groups) is in flight. */
  let recheckInstallsPending = $state(false);

  /** Per FSM: one card per agent role + dispatch token + .fullsend setup. */
  const placeholderCardCount = $derived(
    parsedConfig
      ? Math.max(3, agentsFromConfig(parsedConfig).length + 2)
      : greenfieldDeploy
        ? DEFAULT_FULLSEND_ORG_AGENT_ROLES.length + 2
        : 5,
  );

  function orgGravatarFallback(login: string): string {
    return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  }

  async function loadSetup(): Promise<void> {
    const gen = (loadGen += 1);
    loadAbort?.abort();
    loadAbort = new AbortController();
    const signal = loadAbort.signal;

    pageError = null;
    configValidateError = null;
    analyzeError = null;
    try {
      const raw = sessionStorage.getItem(MANIFEST_POST_RESULT_KEY);
      if (raw) {
        sessionStorage.removeItem(MANIFEST_POST_RESULT_KEY);
        const o = JSON.parse(raw) as {
          ok?: unknown;
          installUrl?: unknown;
          slug?: unknown;
          message?: unknown;
        };
        if (o.ok === true && typeof o.installUrl === "string" && typeof o.slug === "string") {
          manifestFlowError = null;
        } else if (o.ok === false && typeof o.message === "string") {
          manifestFlowError = o.message;
        }
      }
    } catch {
      /* ignore */
    }
    analyzePending = true;
    pendingBoardTitles = [];
    groups = [];
    setupFlow = null;
    greenfieldDeploy = false;
    orgDisplayName = null;
    orgAvatarUrl = null;
    parsedConfig = null;

    const token = loadToken()?.accessToken;
    if (!token || !org) {
      pageError = !org ? "Missing organisation." : "Sign in to load this organisation.";
      analyzePending = false;
      setupFlow = null;
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
      analyzePending = false;
      setupFlow = null;
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
    if (cfg) {
      pendingBoardTitles = setupBoardTitlesFromAgents(agentsFromConfig(cfg));
    }

    try {
      const configProbe = await analyzeConfigRepoLayer(org, gh);
      if (signal.aborted || gen !== loadGen) return;

      greenfieldDeploy = configRepoIsGreenfieldDeploy(configProbe);
      setupFlow = greenfieldDeploy ? "deploy" : "repair";

      const agents = cfg
        ? agentsFromConfig(cfg)
        : greenfieldDeploy
          ? defaultFullsendAgentRows()
          : [];
      pendingBoardTitles = setupBoardTitlesFromAgents(agents);
      const enabledRepos = cfg ? enabledReposFromConfig(cfg) : [];
      const { reports } = await analyzeOrgLayers({
        org,
        gh,
        agents,
        enabledRepos,
      });
      if (signal.aborted || gen !== loadGen) return;

      const configReport = reports.find((r) => r.name === "config-repo");
      const listDeploy = configRepoIsGreenfieldDeploy(configReport);
      greenfieldDeploy = listDeploy;
      setupFlow = listDeploy ? "deploy" : "repair";

      const actorLogin = get(githubUser)?.login?.trim() ?? "";
      const nextGroups = await buildOrgSetupGroups({
        org,
        actorLogin: actorLogin || "unknown",
        octokit,
        gh,
        reports,
        agents,
        parsedConfig: cfg,
        greenfieldDeploy: listDeploy,
      });
      if (signal.aborted || gen !== loadGen) return;
      groups = nextGroups;
    } catch (e) {
      if (signal.aborted || gen !== loadGen) return;
      analyzeError =
        e instanceof Error ? e.message : "Failed to analyze Fullsend deployment status.";
      groups = [];
      setupFlow = null;
      greenfieldDeploy = false;
    } finally {
      if (!signal.aborted && gen === loadGen) {
        analyzePending = false;
      }
    }
  }

  /**
   * Re-fetch layer reports and rebuild setup cards (including org app install list).
   * Used after installing an app in another tab without a full page reload.
   */
  async function recheckOrgAppInstalls(): Promise<void> {
    const token = loadToken()?.accessToken;
    if (!token || !org || analyzePending) return;
    const loadSnapshot = loadGen;
    recheckBusy += 1;
    recheckInstallsPending = true;
    analyzeError = null;
    try {
      const octokit = createUserOctokit(token);
      const gh = createLayerGithub(octokit);
      const cfg = parsedConfig;

      const configProbe = await analyzeConfigRepoLayer(org, gh);
      if (loadGen !== loadSnapshot) return;

      const listDeployProbe = configRepoIsGreenfieldDeploy(configProbe);
      const agents = cfg
        ? agentsFromConfig(cfg)
        : listDeployProbe
          ? defaultFullsendAgentRows()
          : [];
      const enabledRepos = cfg ? enabledReposFromConfig(cfg) : [];
      const { reports } = await analyzeOrgLayers({
        org,
        gh,
        agents,
        enabledRepos,
      });
      if (loadGen !== loadSnapshot) return;

      const configReport = reports.find((r) => r.name === "config-repo");
      const listDeploy = configRepoIsGreenfieldDeploy(configReport);
      const actorLogin = get(githubUser)?.login?.trim() ?? "";
      const nextGroups = await buildOrgSetupGroups({
        org,
        actorLogin: actorLogin || "unknown",
        octokit,
        gh,
        reports,
        agents,
        parsedConfig: cfg,
        greenfieldDeploy: listDeploy,
      });
      if (loadGen !== loadSnapshot) return;
      groups = nextGroups;
      greenfieldDeploy = listDeploy;
      setupFlow = listDeploy ? "deploy" : "repair";
    } catch (e) {
      if (loadGen !== loadSnapshot) return;
      analyzeError =
        e instanceof Error ? e.message : "Failed to refresh deployment status.";
    } finally {
      recheckBusy -= 1;
      if (recheckBusy === 0) {
        recheckInstallsPending = false;
      }
    }
  }

  $effect(() => {
    const o = org;
    const unsub = githubUser.subscribe((u) => {
      if (!o) {
        pageError = "Missing organisation.";
        analyzePending = false;
        setupFlow = null;
        greenfieldDeploy = false;
        setNavOrgContext(null);
        return;
      }
      if (!u) {
        loadAbort?.abort();
        pageError = "Sign in to load this organisation.";
        analyzePending = false;
        groups = [];
        setupFlow = null;
        greenfieldDeploy = false;
        setNavOrgContext(null);
        return;
      }
      void loadSetup();
    });
    return () => {
      unsub();
      loadAbort?.abort();
    };
  });

  $effect(() => {
    const o = org;
    const flow = setupFlow;
    const pending = analyzePending;
    if (!o) {
      setNavOrgContext(null);
      return;
    }
    const orgClusterLinksToDashboard =
      !pending && (flow === null || flow === "repair");
    setNavOrgContext({
      login: o,
      avatarUrl: orgAvatarUrl ?? orgGravatarFallback(o),
      displayName: orgDisplayName,
      ...(flow ? { setupFlow: flow } : {}),
      orgClusterLinksToDashboard,
    });
  });

  function roleFromGithubAppGroupId(id: string): string | null {
    if (!id.startsWith("github_app:")) return null;
    const role = id.slice("github_app:".length);
    return role.length > 0 ? role : null;
  }

  function onGroupPrimaryClick(g: SetupGroupViewModel): void {
    if (g.kind === "github_app") {
      const role = roleFromGithubAppGroupId(g.id);
      if (!role) return;
      if (g.primary?.label === "Create app on GitHub") {
        manifestFlowError = null;
        const actorLogin = get(githubUser)?.login?.trim() ?? "";
        const h = window.location.hash?.trim();
        const returnHash =
          h && h.startsWith("#")
            ? h
            : `#/org/${encodeURIComponent(org)}/setup`;
        stashManifestReturnContext({
          org,
          role,
          actorLogin: actorLogin || "unknown",
          returnHash,
        });
        submitAgentAppManifestSameWindow(org, role, getGithubAppManifestRedirectUri());
        return;
      }
      if (g.primary?.label === "Install app on Organisation" && g.githubAppSlug) {
        const installUrl = githubAppInstallationsNewUrl(g.githubAppSlug);
        const win = window.open(installUrl, "_blank");
        if (win) {
          try {
            win.opener = null;
          } catch {
            /* ignore */
          }
        } else {
          window.location.assign(installUrl);
        }
      }
      return;
    }
    if (g.kind === "dispatch_pat" && g.dispatchPatCreationUrl && g.primary?.label) {
      window.location.assign(g.dispatchPatCreationUrl);
      return;
    }
    if (g.kind === "fullsend_repo_setup" && g.primary) {
      /* Apply bundle not wired in SPA yet (FSM `fs_applying`). */
    }
  }

  onMount(() => {
    return () => {
      setNavOrgContext(null);
    };
  });

  function prereqId(groupId: string): string {
    return `setup-prereq-${groupId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  function setupLinePopoverId(groupId: string, lineId: string): string {
    const g = groupId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const l = lineId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `setup-line-pop-${g}-${l}`;
  }
</script>

<section class="setup" aria-label="Organisation setup">
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

    {#if analyzeError}
      <div class="banner banner--err" role="alert">
        <span class="banner-msg">{analyzeError}</span>
        <button type="button" class="btn banner-retry" onclick={() => void loadSetup()}>
          Retry
        </button>
      </div>
    {/if}

    {#if manifestFlowError}
      <div class="banner banner--err" role="alert">
        <span class="banner-msg">{manifestFlowError}</span>
        <button
          type="button"
          class="btn banner-retry"
          onclick={() => {
            manifestFlowError = null;
          }}
        >
          Dismiss
        </button>
      </div>
    {/if}

    <div class="setup-board">
      {#if analyzePending}
        {#if pendingBoardTitles.length > 0}
          {#each pendingBoardTitles as title (title)}
            <article class="setup-card setup-card--muted" aria-busy="true">
              <div class="setup-card-heading">
                <span class="row-spinner-disc row-spinner-disc--inline" aria-hidden="true"></span>
                <h2 class="setup-card-title">{title}</h2>
              </div>
              <div class="setup-loading" role="status" aria-live="polite">
                <span>Checking…</span>
              </div>
              <ul class="item-lines">
                <li class="item-line item-line--unknown">Pending…</li>
              </ul>
              <button type="button" class="btn" disabled>Loading…</button>
            </article>
          {/each}
        {:else}
          {#each Array.from({ length: placeholderCardCount }, (_, i) => i) as i (i)}
            <article class="setup-card setup-card--muted" aria-busy="true">
              <h2 class="setup-card-title">Checking…</h2>
              <div class="setup-loading" role="status" aria-live="polite">
                <span class="row-spinner-disc" aria-hidden="true"></span>
                <span>Checking…</span>
              </div>
              <ul class="item-lines">
                <li class="item-line item-line--unknown">Pending…</li>
              </ul>
              <button type="button" class="btn" disabled>Loading…</button>
            </article>
          {/each}
        {/if}
      {:else}
        {#each groups as g (g.id)}
          {@const hintId = g.prerequisiteHint ? prereqId(g.id) : undefined}
          <article
            class="setup-card"
            class:setup-card--muted={g.prerequisiteHint !== null}
          >
            <div class="setup-card-heading">
              {#if g.statusIcon === "ok"}
                <span class="status-dot status-dot--ok" aria-hidden="true"></span>
              {:else if g.statusIcon === "warn"}
                <span class="status-warn" aria-hidden="true">▲</span>
              {:else if g.statusIcon === "error"}
                <span class="status-warn" aria-hidden="true">!</span>
              {:else if g.statusIcon === "in_progress"}
                <span class="row-spinner-disc row-spinner-disc--inline" aria-hidden="true"></span>
              {:else}
                <span class="rollup-unknown" aria-hidden="true">?</span>
              {/if}
              <h2 class="setup-card-title">{g.title}</h2>
            </div>
            {#if g.prerequisiteHint}
              <p id={hintId} class="prereq-hint">{g.prerequisiteHint}</p>
            {/if}
            <p class="setup-card-subtitle">{g.subtitle}</p>
            <ul class="item-lines">
              {#each g.itemLines as line (line.id ?? line.label)}
                <li
                  class="item-line item-line-row"
                  class:item-line--ok={line.lineTone === "ok"}
                  class:item-line--warn={line.lineTone === "warn"}
                  class:item-line--err={line.lineTone === "error"}
                  class:item-line--unknown={line.lineTone === "unknown"}
                >
                  <div class="item-line-label-group">
                    <span class="item-line-text">{line.label}</span>
                    {#if line.trailingAction?.kind === "recheck_org_app_installs"}
                      {#if recheckInstallsPending}
                        <span class="item-line-recheck item-line-recheck--pending" aria-live="polite">
                          Checking…
                        </span>
                      {:else}
                        <button
                          type="button"
                          class="item-line-recheck"
                          onclick={() => void recheckOrgAppInstalls()}
                        >
                          {line.trailingAction.label}
                        </button>
                      {/if}
                    {/if}
                  </div>
                  {#if line.detail || line.detailLinkHref}
                    {@const pid = setupLinePopoverId(g.id, line.id ?? "row")}
                    <button
                      type="button"
                      class="info-btn"
                      popovertarget={pid}
                      aria-haspopup="dialog"
                      aria-label="Details for this row"
                    >
                      i
                    </button>
                    <div id={pid} class="setup-line-popover" popover>
                      {#if line.detail}
                        <p class="setup-line-popover-lead">{line.detail}</p>
                      {/if}
                      {#if line.detailLinkHref}
                        <p class="setup-line-popover-link-wrap">
                          <a
                            class="setup-line-popover-link"
                            href={line.detailLinkHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {line.detailLinkLabel ?? line.detailLinkHref}
                          </a>
                        </p>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if g.primary}
              <button
                type="button"
                class="btn"
                class:btn-primary={g.kind === "fullsend_repo_setup"}
                disabled={g.primary.disabled === true}
                aria-describedby={g.prerequisiteHint ? hintId : undefined}
                onclick={() => onGroupPrimaryClick(g)}
              >
                {g.primary.label}
              </button>
            {/if}
          </article>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .setup {
    max-width: 44rem;
    padding-top: 0.25rem;
  }

  .setup-board {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .setup-loading {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
    color: #444;
  }

  .setup-card {
    padding: 1rem 1.1rem;
    border: 1px solid #d0d7de;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(31, 35, 40, 0.04);
  }
  .setup-card--muted {
    opacity: 0.92;
  }
  .setup-card-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.55rem;
    margin: 0 0 0.35rem;
  }
  .setup-card-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .setup-card-subtitle {
    margin: 0 0 0.65rem;
    font-size: 0.88rem;
    color: #57606a;
    line-height: 1.45;
  }
  .prereq-hint {
    margin: 0 0 0.65rem;
    font-size: 0.88rem;
    color: #57606a;
    line-height: 1.45;
  }
  .status-dot {
    display: inline-block;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
  }
  .status-dot--ok {
    background: #1a7f37;
  }
  .status-warn {
    color: #9a6700;
    font-size: 0.85rem;
  }
  .rollup-unknown {
    color: #57606a;
    font-weight: 600;
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
  .row-spinner-disc--inline {
    flex-shrink: 0;
  }

  .item-lines {
    margin: 0 0 0.85rem;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    line-height: 1.45;
    color: #24292f;
  }
  .item-line {
    margin: 0.25rem 0;
  }
  .item-line-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.45rem;
    list-style-position: outside;
  }
  .item-line-label-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.65rem;
    flex: 1;
    min-width: 0;
  }
  .item-line-text {
    min-width: 8rem;
  }
  .item-line-recheck {
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    color: #0969da;
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    white-space: nowrap;
  }
  .item-line-recheck:hover {
    color: #0550ae;
  }
  .item-line-recheck--pending {
    color: #57606a;
    text-decoration: none;
    cursor: default;
    font-size: 0.88rem;
  }
  .item-line-recheck:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
    border-radius: 2px;
  }
  .item-line--unknown {
    color: #8c959f;
  }
  .item-line--ok {
    color: #1a7f37;
  }
  .item-line--warn {
    color: #9a6700;
  }
  .item-line--err {
    color: #a40e26;
  }

  .info-btn {
    box-sizing: border-box;
    min-width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border-radius: 999px;
    border: 1px solid #bf8700;
    background: #fff8c5;
    color: #7d4e00;
    font-size: 0.72rem;
    font-weight: 700;
    font-style: italic;
    cursor: help;
    line-height: 1;
    flex-shrink: 0;
  }
  .info-btn:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
  }
  .setup-line-popover {
    max-width: min(22rem, calc(100vw - 2rem));
    padding: 0.75rem 0.85rem;
    border: 1px solid #d4a72c;
    border-radius: 8px;
    background: #fffef5;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    color: #24292f;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .setup-line-popover-lead {
    margin: 0;
    font-weight: 500;
  }
  .setup-line-popover-link-wrap {
    margin: 0.55rem 0 0;
  }
  .setup-line-popover-link {
    color: #0969da;
    font-weight: 600;
    word-break: break-all;
  }

  .btn {
    cursor: pointer;
    padding: 0.4rem 0.85rem;
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
</style>
