import { createRoot } from 'react-dom/client'
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker'
import { App } from './App.js'
import { installLayoutEngine, workerLayoutEngine } from './elk-layout.js'
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

// ELK runs in a Web Worker here (#490): a routed layout of a large view takes
// most of a second, and on the calling thread that is a frozen page. Vite
// emits the worker file as one more flat asset the session server's asset
// route serves, and the page's policy (`default-src 'self'`) admits a
// same-origin worker. The library bundle has no such certainty about its
// host's policy, so it stays on the bundled engine unless the host says
// otherwise (`workerFactory` in `mountEditor`).
installLayoutEngine(workerLayoutEngine(() => new ElkWorker()))

// No StrictMode: its double mount would open the session socket twice, and this
// bundle only ever runs as the production build the session server serves.
createRoot(mount).render(<App host={createSocketHost()} />)
