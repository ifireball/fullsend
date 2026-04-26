<script lang="ts">
  let { params = { org: "" } }: { params?: { org?: string } } = $props();
  const org = $derived((params?.org ?? "").trim());

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
