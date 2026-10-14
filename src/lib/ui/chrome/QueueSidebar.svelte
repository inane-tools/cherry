<script lang="ts">
  import QueueHeader from './QueueHeader.svelte';
  import QueueList from './QueueList.svelte';
  import { overlayScrollbar } from '$lib/ui/actions/overlayScrollbar';
  import { QUEUE_SIDEBAR_WIDTH } from '$lib/app/services/queueSidebar';
</script>

<aside aria-label="Playback queue" class="cherry-sidebar flex min-h-0 shrink-0 flex-col pt-12" style:width={`${QUEUE_SIDEBAR_WIDTH}px`}>
  <QueueHeader />
  <div use:overlayScrollbar class="cherry-overlay-scroll min-h-0 flex-1 px-3 pb-3">
    <QueueList />
  </div>
</aside>
