<script lang="ts">
  import { params as routeParams } from "svelte-spa-router";

  const org = $derived(String(($routeParams as { org?: string } | undefined)?.org ?? "").trim());

  $effect(() => {
    const o = org;
    if (!o || typeof window === "undefined") return;
    const target = `#/org/${encodeURIComponent(o)}/setup`;
    if (window.location.hash !== target) {
      window.location.replace(
        `${window.location.pathname}${window.location.search}${target}`,
      );
    }
  });
</script>

<p class="redirect-msg" role="status">Opening setup…</p>

<style>
  .redirect-msg {
    margin: 1rem 0;
    font-size: 0.95rem;
    color: #444;
  }
</style>
