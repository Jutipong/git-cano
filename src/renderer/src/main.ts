import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from './App.vue'
import { persistStorage } from './utils/persistStorage'

import './styles.css'
import './modern-ui.css'

function reportError(message: string): void {
    try {
        window.api.clientLog('error', message.slice(0, 2000))
    } catch {}
}

window.addEventListener('error', event => {
    reportError(
        event.error instanceof Error ? (event.error.stack ?? event.error.message) : `${event.message} (${event.filename}:${event.lineno})`
    )
})
window.addEventListener('unhandledrejection', event => {
    const reason = event.reason
    reportError(`Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
})

const app = createApp(App)
app.config.errorHandler = err => {
    reportError(err instanceof Error ? (err.stack ?? err.message) : String(err))
}
app.use(createPinia().use(createPersistedState({ storage: persistStorage })))
app.mount('#root')
