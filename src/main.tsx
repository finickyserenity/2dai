import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import './index.css'
import App from './App.tsx'
import { fitAppToVisualViewport } from './visualViewport.ts'

let serviceWorkerRegistration: ServiceWorkerRegistration | undefined
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW: (_scriptUrl, registration) => {
    serviceWorkerRegistration = registration
  },
})

async function refreshApp() {
  const registration = serviceWorkerRegistration ?? await navigator.serviceWorker?.getRegistration()
  await registration?.update()
  await updateSW(true)
  window.location.reload()
}

fitAppToVisualViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onRefreshApp={refreshApp} />
  </StrictMode>,
)
