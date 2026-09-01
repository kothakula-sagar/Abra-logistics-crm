/* Client-side interaction guards.
 * These are convenience guards only and are not a security boundary.
 * F12 is intentionally left available for browser developer tools.
 */
(function () {
  'use strict';

  // Disable the browser context menu so the Inspect command is not exposed there.
  document.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  }, { capture: true });

  // Disable View Source and common DevTools keyboard shortcuts, while keeping F12.
  document.addEventListener('keydown', function (event) {
    const key = String(event.key || '').toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    // Ctrl/Cmd + U: View Source
    if (ctrlOrMeta && key === 'u') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    // Ctrl/Cmd + Shift + I/J/C: common DevTools entry points.
    // F12 is deliberately not blocked.
    if (ctrlOrMeta && event.shiftKey && ['i', 'j', 'c'].includes(key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    // Ctrl/Cmd + Shift + K is another browser/DevTools console shortcut in some browsers.
    if (ctrlOrMeta && event.shiftKey && key === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
})();
