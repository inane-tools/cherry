import { invoke } from './core';
export const relaunch = () => invoke<void>('app:relaunch');
