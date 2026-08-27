import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from './App.vue'

import './styles.css'
import './modern-ui.css'

//
/** forward renderer-side errors into the main-process log file (best-effort) */
function reportError(message: string): void {
    try {
        window.api.clientLog('error', message.slice(0, 2000))
    } catch {
        /* api unavailable — nothing else to do */
    }
}

window.addEventListener('error', event => {
    reportError(event.error instanceof Error ? (event.error.stack ?? event.error.message) : `${event.message} (${event.filename}:${event.lineno})`)
})
window.addEventListener('unhandledrejection', event => {
    const reason = event.reason
    reportError(`Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
})

const app = createApp(App)
app.config.errorHandler = err => {
    reportError(err instanceof Error ? (err.stack ?? err.message) : String(err))
}
app.use(createPinia().use(piniaPluginPersistedstate))
app.mount('#root')
