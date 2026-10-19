import { writable } from 'svelte/store';
import type { AccountProfile } from '$lib/core/models';

// Shared without account discovery side effects, so channel-owned state can
// follow the applied identity rather than an in-flight settings write.
export const activeChannelStore = writable<AccountProfile | null>(null);
