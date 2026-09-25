# Desktop / renderer boundary

`vrm_frontend/app.js` owns Three.js raycasting. On pointer movement it emits the
`desktop-bridge` DOM event with `{type: "avatar.hit_state", hit: boolean}`. The
payload is described by `desktop-bridge.schema.json`. Electron's avatar preload
relays that state to the host. The host alone owns Windows pointer
passthrough; the renderer does not call Electron APIs. During migration, the preload
also reads `canvas.style.cursor` if the explicit signal is stale or an older renderer
is loaded.

Audio payloads keep `actions.expressions` as numeric Live2D expression IDs for
the bundled 2D client. They also carry `actions.emotions` as semantic labels
such as `joy` and `sadness`; the 3D renderer uses those labels to select VRM
expressions without depending on a particular Live2D model's expression map.

The renderer's existing `/client-ws` connection remains the sole conversation
connection. The VRM renderer declares `playback-complete` in a
`frontend-capabilities` message when it connects. After the backend sends
`backend-synth-complete`, that renderer sends `frontend-playback-complete` once its
audio has decoded, its queue is empty, and the current audio has ended. The backend
then sends `force-new-message` followed by `control: conversation-chain-end`.
`playback.schema.json` describes these messages. Older clients, including the
bundled 2D frontend, do not declare this feature, so the backend skips the ACK wait
for them and preserves their existing turn-finalization behavior.

For capable clients, the ACK watchdog is the total duration of the generated audio
plus a 30-second allowance for decoding, scheduling, and transport. Audio duration
is measured from the same decoded media used to build the WAV payload. Interrupt or
socket close clears the pending renderer ACK.

This file describes the messages implemented today. Other proposed bridge messages
will be added with their handlers, rather than advertised before they work.
