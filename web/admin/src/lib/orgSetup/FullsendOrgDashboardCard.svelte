<script lang="ts">
  import type { LayerReport } from "../status/types";
  import { dashboardFullsendInstallCardViewModel } from "./buildOrgSetupGroups";

  type Props = {
    org: string;
    pending: boolean;
    error: string | null;
    reports: LayerReport[] | null;
    roles: string[];
    onRetry: () => void;
  };

  let { org, pending, error, reports, roles, onRetry }: Props = $props();

  const vm = $derived(
    !pending && !error && reports && reports.length > 0
      ? dashboardFullsendInstallCardViewModel({ org, reports, roles })
      : null,
  );
</script>

<div class="dash-fullsend-wrap">
  {#if pending}
    <article class="setup-card setup-card--muted" aria-busy="true" aria-label=".fullsend repository setup">
      <div class="setup-card-headrow">
        <div class="setup-card-heading">
          <span class="row-spinner-disc row-spinner-disc--inline" aria-hidden="true"></span>
          <h2 class="setup-card-title">.fullsend repository setup</h2>
        </div>
      </div>
      <div class="setup-loading" role="status" aria-live="polite">
        <span>Checking…</span>
      </div>
      <ul class="item-lines">
        <li class="item-line item-line-row item-line--unknown">Pending…</li>
      </ul>
      <div class="setup-card-actions">
        <button type="button" class="btn" disabled>Loading…</button>
      </div>
    </article>
  {:else if error}
    <article class="setup-card setup-card--err" aria-label=".fullsend repository setup">
      <div class="setup-card-headrow">
        <h2 class="setup-card-title setup-card-title--solo">.fullsend repository setup</h2>
      </div>
      <p class="setup-card-err" role="alert">{error}</p>
      <div class="setup-card-actions">
        <button type="button" class="btn" onclick={() => onRetry()}>Retry</button>
      </div>
    </article>
  {:else if vm}
    <article class="setup-card" aria-label={vm.title}>
      <div class="setup-card-headrow">
        <div class="setup-card-heading">
          {#if vm.statusIcon === "ok"}
            <span class="status-dot status-dot--ok" aria-hidden="true"></span>
          {:else if vm.statusIcon === "warn"}
            <span class="status-warn" aria-hidden="true">▲</span>
          {:else if vm.statusIcon === "error"}
            <span class="status-warn" aria-hidden="true">!</span>
          {:else if vm.statusIcon === "in_progress"}
            <span class="row-spinner-disc row-spinner-disc--inline" aria-hidden="true"></span>
          {:else}
            <span class="rollup-unknown" aria-hidden="true">?</span>
          {/if}
          <h2 class="setup-card-title">{vm.title}</h2>
        </div>
      </div>
      <p class="setup-card-subtitle">{vm.subtitle}</p>
      <ul class="item-lines">
        {#each vm.itemLines as line (line.id ?? line.label)}
          <li
            class="item-line item-line-row"
            class:item-line--ok={line.lineTone === "ok"}
            class:item-line--warn={line.lineTone === "warn"}
            class:item-line--err={line.lineTone === "error"}
            class:item-line--unknown={line.lineTone === "unknown"}
          >
            <span class="item-line-text">{line.label}</span>
          </li>
        {/each}
      </ul>
      {#if vm.linkLabel}
        <div class="setup-card-actions">
          <a class="btn" class:btn-primary={vm.linkPrimary} href={vm.setupHref}>
            {vm.linkLabel}
          </a>
        </div>
      {/if}
    </article>
  {:else}
    <article class="setup-card setup-card--muted" aria-label=".fullsend repository setup">
      <div class="setup-card-headrow">
        <h2 class="setup-card-title setup-card-title--solo">.fullsend repository setup</h2>
      </div>
      <p class="setup-card-subtitle">
        Status is not available yet. Open the org setup page to install or repair Fullsend.
      </p>
      <div class="setup-card-actions">
        <a class="btn btn-primary" href="#/org/{encodeURIComponent(org)}/setup">Open org setup</a>
      </div>
    </article>
  {/if}
</div>

<style>
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .dash-fullsend-wrap {
    margin: 0;
  }

  .setup-card-headrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 1rem;
    margin: 0 0 0.5rem;
  }
  .setup-card-title--solo {
    margin: 0;
  }

  .setup-card-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.35rem;
    padding-top: 0.5rem;
    border-top: 1px solid #eaeef2;
  }

  .setup-card {
    padding: 1rem 1.1rem;
    border: 1px solid #d0d7de;
    border-radius: 10px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(31, 35, 40, 0.04);
    max-width: 44rem;
  }
  .setup-card--muted {
    opacity: 0.92;
  }
  .setup-card--err {
    border-color: #f0b2b2;
    background: #fff8f8;
  }
  .setup-card-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.55rem;
    margin: 0;
    min-width: 0;
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
  .setup-card-err {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: #a40e26;
    line-height: 1.45;
  }
  .setup-loading {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
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
  .row-spinner-disc--inline {
    width: 1rem;
    height: 1rem;
    border-width: 2px;
    flex-shrink: 0;
  }

  /* Match OrgSetup.svelte deploy/repair item line colours */
  .item-lines {
    margin: 0 0 0.85rem;
    padding-left: 1.1rem;
    font-size: 0.9rem;
    line-height: 1.45;
    color: #24292f;
    list-style: disc;
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
  .item-line-text {
    min-width: 8rem;
    word-break: break-word;
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

  .btn {
    cursor: pointer;
    padding: 0.35rem 0.75rem;
    border: 1px solid #888;
    border-radius: 6px;
    background: #f4f4f4;
    font: inherit;
    font-size: 0.88rem;
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
  .btn-primary {
    background: #0969da;
    border-color: #0969da;
    color: #fff;
  }
  .btn:focus-visible {
    outline: 2px solid #0969da;
    outline-offset: 2px;
  }
</style>
