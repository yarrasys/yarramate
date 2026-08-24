import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { createSocketHost } from './socket-host.js'
import './styles.css'

const mount = document.getElementById('visual-session')
if (mount === null) {
  throw new Error('The visual session page has no mount point')
}

/**
 * The page `yarramate-visual` serves: the editor, over the session server.
 *
 * One of two entries now (#252). This one has a server behind it and every
 * section on; `mount.tsx` is the one an embedder calls, with a store instead of
 * a socket and only the sections it asked for.
 */

// No StrictMode: its double mount would open the session socket twice, and this
// bundle only ever runs as the production build the session server serves.
createRoot(mount).render(<App host={createSocketHost()} />)
