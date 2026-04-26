<script lang="ts">
  import { onMount } from "svelte";
  import { RequestError } from "@octokit/request-error";
  import { githubUser } from "../lib/auth/session";
  import { setNavOrgContext } from "../lib/shell/navOrgContext";
  import { loadToken } from "../lib/auth/tokenStore";
  import { createUserOctokit } from "../lib/github/client";
  import { analyzeOrgLayers } from "../lib/layers/analyzeOrg";
  import {
    CONFIG_FILE_PATH,
    CONFIG_REPO_NAME,
  } from "../lib/layers/constants";
  import { createLayerGithub } from "../lib/layers/githubClient";
  import {
    agentsFromConfig,
    enabledReposFromConfig,
    parseOrgConfigYaml,
    validateOrgConfig,
    type OrgConfigYaml,
  } from "../lib/layers/orgConfigParse";
  import { mapAnalyzeToGroups } from "../lib/orgSetup/mapAnalyzeToGroups";
  import type { SetupGroupViewModel } from "../lib/orgSetup/types";

  let { params = { org: "" } }: { params?: { org?: string } } = $props();
  const org = $derived(decodeURIComponent((params?.org ?? "").trim()));

  let loadGen = 0;
  let loadAbort: AbortController | null = null;

  let pageError = $state<string | null>(null);
  let orgDisplayName = $state<string | null>(null);
  let orgAvatarUrl = $state<string | null>(null);

  let parsedConfig = $state<OrgConfigYaml | null>(null);
  let configValidateError = $state<string | null>(null);
  let analyzeError = $state<string | null>(null);
  let analyzePending = $state(true);
  let groups = $state<SetupGroupViewModel[]>([]);
  /** Drives nav bar "Deploy" vs "Repair" cluster after org; null until analyze succeeds. */
  let setupFlow = $state<"deploy" | "repair" | null>(null);

  const placeholderCardCount = $derived(
    parsedConfig
      ? Math.max(1, agentsFromConfig(parsedConfig).length + 1)
      : 2,
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
    analyzePending = true;
    groups = [];
    setupFlow = null;
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

    try {
      const agents = cfg ? agentsFromConfig(cfg) : [];
      const enabledRepos = cfg ? enabledReposFromConfig(cfg) : [];
      const { reports, rollup } = await analyzeOrgLayers({
        org,
        gh,
        agents,
        enabledRepos,
      });
      if (signal.aborted || gen !== loadGen) return;
      groups = mapAnalyzeToGroups(reports, agents);
      setupFlow = rollup === "not_installed" ? "deploy" : "repair";
    } catch (e) {
      if (signal.aborted || gen !== loadGen) return;
      analyzeError =
        e instanceof Error ? e.message : "Failed to analyze Fullsend deployment status.";
      groups = [];
      setupFlow = null;
    } finally {
      if (!signal.aborted && gen === loadGen) {
        analyzePending = false;
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
        setNavOrgContext(null);
        return;
      }
      if (!u) {
        loadAbort?.abort();
        pageError = "Sign in to load this organisation.";
        analyzePending = false;
        groups = [];
        setupFlow = null;
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
    if (!o) {
      setNavOrgContext(null);
      return;
    }
    setNavOrgContext({
      login: o,
      avatarUrl: orgAvatarUrl ?? orgGravatarFallback(o),
      displayName: orgDisplayName,
      ...(flow ? { setupFlow: flow } : {}),
    });
  });

  onMount(() => {
    return () => setNavOrgContext(null);
  });

  function prereqId(groupId: string): string {
    return `setup-prereq-${groupId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
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

    <div class="setup-board">
      {#if analyzePending}
        {#each Array.from({ length: placeholderCardCount }, (_, i) => i) as i (i)}
          <article class="setup-card setup-card--muted" aria-busy="true">
            <h2 class="setup-card-title">Checking…</h2>
            <div class="rollup rollup--loading" role="status" aria-live="polite">
              <span class="row-spinner-disc" aria-hidden="true"></span>
              <span>Checking…</span>
            </div>
            <ul class="item-lines">
              <li class="item-line item-line--unknown">Pending…</li>
            </ul>
            <button type="button" class="btn" disabled>Loading…</button>
          </article>
        {/each}
      {:else}
        {#each groups as g (g.id)}
          {@const hintId = g.prerequisiteHint ? prereqId(g.id) : undefined}
          <article
            class="setup-card"
            class:setup-card--muted={g.prerequisiteHint !== null}
          >
            <h2 class="setup-card-title">{g.title}</h2>
            {#if g.prerequisiteHint}
              <p id={hintId} class="prereq-hint">{g.prerequisiteHint}</p>
            {/if}
            <div class="rollup rollup--{g.rollupTone}" role="status">
              {#if g.rollupTone === "ok"}
                <span class="status-dot status-dot--ok" aria-hidden="true"></span>
              {:else if g.rollupTone === "warn"}
                <span class="status-warn" aria-hidden="true">▲</span>
              {:else if g.rollupTone === "error"}
                <span class="status-warn" aria-hidden="true">!</span>
              {:else}
                <span class="rollup-unknown" aria-hidden="true">?</span>
              {/if}
              <span>{g.rollupHeadline}</span>
            </div>
            <ul class="item-lines">
              {#each g.itemLines as line (line)}
                <li class="item-line">{line}</li>
              {/each}
            </ul>
            <button
              type="button"
              class="btn"
              class:btn-primary={g.kind === "automation"}
              disabled={g.primary.disabled}
              aria-describedby={g.prerequisiteHint ? hintId : undefined}
            >
              {g.primary.label}
            </button>
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
  .setup-card-title {
    margin: 0 0 0.35rem;
    font-size: 1rem;
    font-weight: 600;
  }
  .prereq-hint {
    margin: 0 0 0.65rem;
    font-size: 0.88rem;
    color: #57606a;
    line-height: 1.45;
  }
  .rollup {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.6rem;
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
  }
  .rollup--loading {
    color: #444;
  }
  .rollup--ok {
    color: #24292f;
  }
  .rollup--warn {
    color: #24292f;
  }
  .rollup--error {
    color: #a40e26;
  }
  .rollup--unknown {
    color: #444;
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
  .item-line--unknown {
    color: #8c959f;
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
