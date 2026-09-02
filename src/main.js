/**
 * main.js — entry point.
 *
 * Browsers block audio until a user gesture, so nothing is instantiated until
 * the first click on "Start engine" (see App.toggleEngine).
 */

import { App } from './ui/app.js';

const app = new App();

// Expose for console tinkering: window.slate.pt.setThrottle(1)
window.slate = app;
