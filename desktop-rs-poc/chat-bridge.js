(() => {
  const invoke = window.__TAURI__.core.invoke;
  const action = (action, payload=null) => invoke('chat_action', {action,payload}).catch(error => {
    window.dispatchEvent(new CustomEvent('pet-chat-error', {detail:String(error)}));
  });
  window.petChat = {
    getLog: () => invoke('chat_snapshot'),
    sendText: text => action('send',{type:'text-input',text}),
    interrupt: () => action('send',{type:'interrupt-signal',text:'interrupt'}),
    sendAudioChunk: audio => action('send',{type:'mic-audio-data',audio}),
    endAudio: () => action('send',{type:'mic-audio-end'}),
    hide: () => action('hide'),
    setAutoHide: value => action('autoHide',value),
    setCollapsed: value => action('collapsed',value),
    onAppend: handler => window.__TAURI__.event.listen('chat-append',e=>handler(e.payload)),
    onStatus: handler => window.__TAURI__.event.listen('chat-status',e=>handler(e.payload))
  };
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelector('header')?.setAttribute('data-tauri-drag-region','');
  });
})();
