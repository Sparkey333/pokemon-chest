/* Pokémon Den — install & offline support.
 *
 * Turns the served app into something you can keep on a phone home screen.
 * Loads after app.js/revamp.js so everything it touches already exists.
 *
 * Deliberately does nothing inside the desktop app: Tauri already IS the
 * installed form, and a service worker sitting in front of its asset loader
 * only creates a second, staler copy of the app to debug. Same for file://.
 */
(function () {
  'use strict';

  const isTauri = typeof window.__TAURI__ !== 'undefined'
    || typeof window.__TAURI_INTERNALS__ !== 'undefined';
  const servedOverHttp = location.protocol === 'http:' || location.protocol === 'https:';
  // Service workers need a secure context; localhost counts as one.
  const secure = window.isSecureContext;

  const PWA = window.PWA = {
    supported: 'serviceWorker' in navigator && servedOverHttp && secure && !isTauri,
    installed: window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true,
    prompt: null,          // Chrome/Android hands us a deferred install event
    ready: false,
  };

  if (PWA.supported) {
    // After load, so registering never competes with first paint.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          PWA.ready = true;
          // A new build is waiting: take over on the next navigation rather
          // than swapping the app out from under someone mid-edit.
          if (reg.waiting) reg.waiting.postMessage('skipWaiting');
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) PWA.updateWaiting = true;
            });
          });
        })
        .catch(() => { /* offline support is a bonus, never a hard failure */ });
    });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    PWA.prompt = e;
    const b = document.getElementById('pwaInstallBtn');
    if (b) b.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    PWA.installed = true;
    PWA.prompt = null;
    const b = document.getElementById('pwaInstallBtn');
    if (b) b.hidden = true;
  });

  /* Android/Chrome can install on a tap. iOS has no API for it at all — Safari
     only installs via its own Share → Add to Home Screen, so there the honest
     move is to say so rather than show a button that can't work. */
  window.pwaInstall = async function pwaInstall() {
    if (PWA.prompt) {
      PWA.prompt.prompt();
      const { outcome } = await PWA.prompt.userChoice;
      if (outcome === 'accepted') PWA.prompt = null;
      return outcome;
    }
    if (typeof toast === 'function') {
      toast(pwaIsIOS()
        ? 'On iPhone: tap Share ⬆︎ → Add to Home Screen.'
        : 'Your browser will offer to install this from its own menu.');
    }
    return 'unavailable';
  };

  window.pwaIsIOS = function pwaIsIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent)
      // iPadOS 13+ reports itself as a Mac; the touch points give it away.
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };

  /* One line of copy for the Scanner's phone-mode panel, matched to the device
     actually reading it. */
  window.pwaInstallHint = function pwaInstallHint() {
    if (PWA.installed) return 'Installed — this is running as its own app.';
    if (pwaIsIOS()) return 'Add it to your home screen: tap Share ⬆︎ → <b>Add to Home Screen</b>. It then opens fullscreen with no browser chrome, and works offline.';
    if (PWA.prompt) return 'Your browser can install this as an app — tap <b>Install app</b> below.';
    return 'Open this page on your phone, then use your browser’s <b>Install</b> / <b>Add to Home Screen</b> option to keep it there.';
  };
})();
