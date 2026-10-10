<script lang="ts">
  export let title: string;
  export let description = '';
  export let onClose: () => void;
</script>

<header class="relative shrink-0 px-6 pb-6 pt-6">
  <div class="pr-8">
    <h2 class="text-[26px] font-extrabold tracking-tight text-white sm:text-[32px]">{title}</h2>
    {#if description}
      <p class="mt-1 text-[12px] leading-relaxed text-zinc-500">{description}</p>
    {/if}
  </div>
  <button
    class="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-zinc-300 transition-colors hover:bg-white/[0.12] hover:text-white"
    aria-label={`Close ${title.toLowerCase()}`}
    onclick={onClose}
  >
    <i class="bx bx-x text-xl"></i>
  </button>
</header>
