import '@fontsource-variable/zalando-sans';
import 'boxicons/css/boxicons.min.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
