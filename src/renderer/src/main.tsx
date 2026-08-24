import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

document.documentElement.dataset.theme = localStorage.getItem('ogit-theme') ?? 'dark'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
