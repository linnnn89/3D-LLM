(() => {
  'use strict';
  if (window.__petHost) return;
  const invoke = (command, args) => window.__TAURI__.core.invoke(command, args)
    .catch(error => console.error(`Pet ${command} failed:`, error));
  let press = null;
  const frozen = new Set();
  let menuOpen = false;
  const canvas = () => document.querySelector('#canvas-container canvas');

  function endPress(event) {
    if (!press || (event && event.pointerId !== press.id)) return;
    const previous = press;
    press = null;
    if (previous.dragging && event) event.stopImmediatePropagation();
    if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
    // Keep OrbitControls disabled until this pointerup has reached the model click handler.
    queueMicrotask(() => {
      if (window.controls) window.controls.enabled = previous.controlsEnabled;
    });
  }

  window.addEventListener('pointerdown', event => {
    if (event.target !== canvas()) return;
    if (event.button === 2) {
      event.stopImmediatePropagation();
      return;
    }
    if (event.button !== 0 || event.altKey || menuOpen) return;
    press = { id: event.pointerId, x: event.screenX, y: event.screenY,
      target: event.target, controlsEnabled: window.controls?.enabled ?? true, dragging: false };
    if (window.controls) window.controls.enabled = false;
    event.target.setPointerCapture(event.pointerId);
  }, true);

  window.addEventListener('pointermove', event => {
    if (!press || event.pointerId !== press.id) return;
    event.stopImmediatePropagation();
    if (!(event.buttons & 1)) { endPress(); return; }
    if (press.dragging || Math.hypot(event.screenX - press.x, event.screenY - press.y) < 6) return;
    press.dragging = true;
    // Windows owns the move loop, including dragging beyond the original window bounds.
    invoke('start_avatar_drag');
  }, true);
  window.addEventListener('pointerup', endPress, true);
  window.addEventListener('pointercancel', event => {
    if (press) press.dragging = true;
    endPress(event);
  }, true);
  window.addEventListener('blur', () => endPress());
  window.addEventListener('contextmenu', event => {
    if (event.target !== canvas()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (menuOpen) return;
    endPress();
    menuOpen = true;
    invoke('open_pet_menu').finally(() => { menuOpen = false; });
  }, true);

  window.addEventListener('desktop-bridge', event => {
    const value = event.detail;
    if (!press && !menuOpen && value?.type === 'avatar.hit_state' && typeof value.hit === 'boolean') {
      invoke('set_hit_state', { hit: value.hit });
    }
    if (value?.type === 'avatar.characters') {
      invoke('sync_character_menu', { options: value.options, active: value.active, connected: value.connected });
    }
  });
  window.addEventListener('__pet-pointer', event => {
    if (press || frozen.size || menuOpen) return;
    canvas()?.dispatchEvent(new PointerEvent('pointermove', {
      clientX: event.detail.x, clientY: event.detail.y, bubbles: true
    }));
  });

  window.__petHost = {
    version: 1,
    ready() { return window.__petRenderer?.snapshot() ?? {ready:false, connected:false}; },
    resetView() { return window.__petRenderer?.resetView() ?? {ok:false,reason:'not-ready'}; },
    freeze(reason='resize') {
      endPress(); frozen.add(reason);
      return window.__petRenderer?.setPaused(reason,true) ?? {ok:false,reason:'not-ready'};
    },
    resume(reason='resize') {
      frozen.delete(reason);
      return window.__petRenderer?.setPaused(reason,false) ?? {ok:false,reason:'not-ready'};
    }
  };
  const synchronize = () => {
    for (const reason of frozen) window.__petRenderer?.setPaused(reason,true);
    invoke('sync_chat', {message:{type:window.__petRenderer?.snapshot().connected ? 'desktop-connected' : 'desktop-disconnected'}});
  };
  window.addEventListener('desktop-bridge', event => {
    if (event.detail?.type==='avatar.chat') invoke('sync_chat',{message:event.detail.message});
    if (event.detail?.type==='avatar.ready') synchronize();
  });
  synchronize();
  // Injection may happen after the initial WebSocket messages were received.
  if (window.__petCharacters) invoke('sync_character_menu', window.__petCharacters.snapshot());
})();
