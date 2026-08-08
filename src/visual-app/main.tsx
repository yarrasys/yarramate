import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

const mount = document.getElementById('visual-session')
if (mount === null) {
  throw new Error('The visual session page has no mount point')
}

// No StrictMode: its double mount would open the session socket twice, and this
// bundle only ever runs as the production build the session server serves.
createRoot(mount).render(<App />)
