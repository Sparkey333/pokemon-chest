/* Pokémon Den — accessibility layer.
 *
 * Loaded last, on purpose. Everything here decorates UI that app.js and
 * revamp.js have already built, so none of it has to be threaded through
 * nineteen render functions — and none of those render functions has to
 * remember to keep it in sync.
 *
 * What it fixes:
 *   · The tab strip was nineteen unlabelled <button>s. It is now a real ARIA
 *     tablist with roving tabindex and arrow-key navigation, so it is
 *     reachable without a mouse and reads correctly to a screen reader.
 *   · Views become tabpanels tied to their tab, and the inactive ones are
 *     hidden from assistive tech rather than merely painted off.
 *   · Modals are built by innerHTML into #modalRoot from a dozen call sites.
 *     A MutationObserver gives every one of them dialog semantics, a focus
 *     trap, Escape-to-close and focus restore, without editing any of them.
 *   · A polite live region announces view changes, which are otherwise silent.
 *
 * Both stores check this on review, and it is the difference between the app
 * being usable one-handed on a phone and not.
 */
(function () {
  'use strict';

  const tabs = () => Array.from(document.querySelectorAll('#tabs .tab'));

  /* ---------- live region ---------- */
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  document.body.appendChild(live);
  function announce(msg) {
    // Clearing first forces a re-announcement when the text is unchanged.
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 30);
  }

  /* ---------- tablist wiring ---------- */
  function wireTabs() {
    tabs().forEach(t => {
      const v = t.dataset.view;
      if (!v) return;
      const panel = document.getElementById('view-' + v);
      t.id = t.id || 'tab-' + v;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', 'view-' + v);
      if (panel) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', t.id);
        panel.setAttribute('tabindex', '0');
      }
    });
    syncTabs();
  }

  /* Roving tabindex: exactly one tab is in the tab order at a time, and the
     arrow keys move between them. This is the documented ARIA pattern — Tab
     should step past the whole strip, not through all nineteen buttons. */
  function syncTabs() {
    const cur = (window.State && State.view) || 'dashboard';
    tabs().forEach(t => {
      const on = t.dataset.view === cur;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
      const panel = document.getElementById('view-' + t.dataset.view);
      if (panel) {
        // aria-hidden, not hidden: the CSS .active class still owns layout.
        if (on) panel.removeAttribute('aria-hidden');
        else panel.setAttribute('aria-hidden', 'true');
      }
    });
  }

  document.addEventListener('keydown', e => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('tab')) return;
    const list = tabs();
    const i = list.indexOf(t);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j == null) return;
    e.preventDefault();
    list[j].focus();
    if (typeof switchView === 'function') switchView(list[j].dataset.view);
  });

  /* Wrap switchView (revamp.js already wraps it once — wrapping a wrapper is
     fine, each layer just adds its own concern). */
  function hookSwitchView() {
    const base = window.switchView;
    if (typeof base !== 'function') return false;
    window.switchView = function (v) {
      base.apply(this, arguments);
      syncTabs();
      const tab = document.querySelector(`#tabs .tab[data-view="${v}"]`);
      if (tab) announce(tab.textContent.trim() + ' — loaded');
      return undefined;
    };
    return true;
  }

  /* ---------- modal semantics + focus trap ---------- */
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),details,summary,[tabindex]:not([tabindex="-1"])';
  let lastFocus = null;

  function trapKeys(e) {
    const modal = document.querySelector('#modalRoot .modal');
    if (!modal) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof closeModal === 'function') closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function decorateModal(modal) {
    const bg = modal.closest('.modal-bg') || modal.parentElement;
    if (bg) { bg.setAttribute('role', 'presentation'); }
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const h = modal.querySelector('h2, h3');
    if (h) {
      h.id = h.id || 'modal-title-' + Math.random().toString(36).slice(2, 8);
      modal.setAttribute('aria-labelledby', h.id);
    } else {
      modal.setAttribute('aria-label', 'Details');
    }
    const x = modal.querySelector('.close-x, #modalClose');
    if (x) { x.setAttribute('aria-label', 'Close'); if (!x.title) x.title = 'Close'; }
    // Focus the close button rather than the first field: it is the escape
    // hatch, and it puts the caret nowhere destructive.
    const target = x || modal.querySelector(FOCUSABLE) || modal;
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    setTimeout(() => { try { target.focus(); } catch (e) { } }, 20);
    document.addEventListener('keydown', trapKeys);
  }

  function watchModals() {
    const root = document.getElementById('modalRoot');
    if (!root) return;
    new MutationObserver(() => {
      const modal = root.querySelector('.modal');
      if (modal && !modal.dataset.a11y) {
        modal.dataset.a11y = '1';
        lastFocus = document.activeElement;
        decorateModal(modal);
      } else if (!modal) {
        document.removeEventListener('keydown', trapKeys);
        if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (e) { } }
        lastFocus = null;
      }
    }).observe(root, { childList: true, subtree: true });
  }

  /* ---------- labels the markup can't carry ---------- */
  function labelChrome() {
    const pairs = [
      ['#refreshBtn', 'Refresh data'], ['#helpBtn', 'Guide'], ['#alertsBtn', 'Price alerts'],
      ['#settingsBtn', 'Live data and AI settings'], ['#aboutBtn', 'About and legal'],
    ];
    pairs.forEach(([sel, label]) => {
      const el = document.querySelector(sel);
      if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    });
    const badge = document.getElementById('alertsBadge');
    if (badge) badge.setAttribute('aria-hidden', 'true');   // the count is in the button's label
  }

  function start() {
    wireTabs();
    hookSwitchView();
    watchModals();
    labelChrome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
