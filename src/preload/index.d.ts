export {}

declare global {
  interface Window {
    api: import('./index').Api
  }
}
