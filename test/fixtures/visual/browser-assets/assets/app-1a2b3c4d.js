/**
 * Hashed asset stand-in for the browser application bundle.
 *
 * The session server serves `/assets/{hashed-file}` as an opaque static route,
 * so the fixture only has to be a real, same-origin module that the static
 * route can resolve, read, and label with a content type.
 */
const state = document.getElementById('visual-session-state')

const socket = new WebSocket(`ws://${location.host}/socket`)
socket.addEventListener('open', () => {
  if (state !== null) state.textContent = 'Connected'
})
socket.addEventListener('close', () => {
  if (state !== null) state.textContent = 'Disconnected'
})
