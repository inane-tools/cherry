import { invoke } from './core';
export const openUrl = (url: string) => invoke<void>('app:open-url', { url });
