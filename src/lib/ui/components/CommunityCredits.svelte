<script lang="ts">
  import githubMark from '$lib/assets/github.svg?raw';
  import claudeMark from '$lib/assets/claude.svg?raw';
  import opencodeMark from '$lib/assets/opencode.svg?raw';
  import openaiMark from '$lib/assets/openai.svg?raw';
  import codexMark from '$lib/assets/codex.svg?raw';
  import deepseekMark from '$lib/assets/deepseek.svg?raw';

  export let openExternal: (url: string) => Promise<void>;

  function follow(event: MouseEvent, url: string) {
    event.preventDefault();
    void openExternal(url);
  }
</script>

{#snippet contributorMarks(first: string, second: string)}
  <span class="relative h-7 w-8 shrink-0 text-base text-zinc-300" aria-hidden="true">
    <span class="absolute left-0 top-0 flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{@html first}</span>
    <span class="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{@html second}</span>
  </span>
{/snippet}

<section class="mt-5 border-t border-white/[0.06] pt-4" aria-labelledby="contributors-heading">
  <h3 id="contributors-heading" class="text-[14px] font-semibold tracking-tight text-white">Contributors</h3>
  <ul class="mt-3 space-y-4 text-[11px] leading-relaxed text-zinc-400">
    <li class="flex items-center gap-2.5">
      {@render contributorMarks(githubMark, claudeMark)}
      <div class="min-w-0">
        <a class="text-[12px] font-semibold text-zinc-300 transition-colors hover:text-white"
          href="https://github.com/jannuary/cherry" onclick={(event) => follow(event, 'https://github.com/jannuary/cherry')}>Jannuary &amp; Claude</a>
        <p class="mt-0.5">Audited the original Tauri build of Cherry and committed the sleep timer, repeat button, keyboard shortcuts and tests.</p>
      </div>
    </li>
    <li class="flex items-center gap-2.5">
      {@render contributorMarks(opencodeMark, deepseekMark)}
      <div class="min-w-0">
        <p class="text-[12px] font-semibold text-zinc-300">OpenCode <span class="font-normal text-zinc-400">(DeepSeek v4.1 Flash)</span></p>
        <p class="mt-0.5">Initial scaffolding, programming from v0 to v1.5.</p>
      </div>
    </li>
    <li class="flex items-center gap-2.5">
      {@render contributorMarks(openaiMark, codexMark)}
      <div class="min-w-0">
        <p class="text-[12px] font-semibold text-zinc-300">OpenAI Codex <span class="font-normal text-zinc-400">(GPT-6.1 Sol)</span></p>
        <p class="mt-0.5">Programming since v1.5.</p>
      </div>
    </li>
  </ul>
</section>

<section class="mt-5 border-t border-white/[0.06] pt-4" aria-labelledby="lyrics-provider-heading">
  <h3 id="lyrics-provider-heading" class="text-[14px] font-semibold tracking-tight text-white">Lyrics providers</h3>
  <div class="mt-3 space-y-3 text-[11px] leading-relaxed text-zinc-400">
    <div>
      <a class="text-[12px] font-semibold text-[var(--color-accent2)] hover:underline"
        href="https://lrclib.net/" onclick={(event) => follow(event, 'https://lrclib.net/')}>LRCLIB</a>
      <p class="mt-1">Community-sourced lyrics &amp; timing. Synchronized lyrics rely on LRCLIB.
        Consider supporting them.
        LRCLIB is in no way affiliated with Cherry. What they are doing is awesome.</p>
    </div>
    <div>
      <p class="text-[12px] font-semibold text-zinc-300">YouTube Music</p>
      <p class="mt-1">If LRCLIB does not have lyrics for a song, YouTube Music is used as a fallback.</p>
    </div>
  </div>
</section>
