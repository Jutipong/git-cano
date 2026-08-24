import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'

import App from './App.vue'

import './styles.css'
import './modern-ui.css'

const app = createApp(App)
app.use(createPinia().use(piniaPluginPersistedstate))
app.mount('#root')
