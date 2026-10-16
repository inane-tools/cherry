import { invoke } from './core';
export class Store {
  static async load(name: string): Promise<Store> {
    if (name !== 'cherry-settings.json') throw new Error('Unknown settings store');
    return new Store();
  }
  get<T>(key: string): Promise<T | null> { return invoke<T | null>('settings:get', { key }); }
  set(key: string, value: unknown): Promise<void> { return invoke('settings:set', { key, value }); }
  async save(): Promise<void> { /* set() resolves only once its atomic disk write finishes. */ }
}
