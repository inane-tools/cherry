<script lang="ts">
  import QueueHeader from './QueueHeader.svelte';
  import QueueList from './QueueList.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { QUEUE_SIDEBAR_WIDTH } from '$lib/app/services/queueSidebar';
</script>

<aside aria-label="Playback queue" class="cherry-queue-rail pointer-events-none absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col px-2" style:width={`${QUEUE_SIDEBAR_WIDTH}px`}>
  <div class="cherry-sidebar pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
  <QueueHeader />
  <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-3 pb-3">
    <QueueList />
  </div>
  </div>
</aside>
