import '@fontsource-variable/gabarito';
import './lib/ui/icons.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { restoreStartupAppearance } from './lib/app/services/theme';

restoreStartupAppearance();
const app = mount(App, { target: document.getElementById('app')! });

export default app;
