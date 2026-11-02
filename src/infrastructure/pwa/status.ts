import { ref } from "vue";
import { registerSW } from "virtual:pwa-register";

export const isOnline = ref(navigator.onLine);
export const offlineReady = ref(false);
export const updateAvailable = ref(false);
export const pwaError = ref(false);
window.addEventListener("online", () => {
  isOnline.value = true;
});
window.addEventListener("offline", () => {
  isOnline.value = false;
});
export const updateServiceWorker = registerSW({
  onOfflineReady: () => {
    offlineReady.value = true;
  },
  onNeedRefresh: () => {
    updateAvailable.value = true;
  },
  onRegisteredSW: (_url, registration) => {
    if (registration)
      void navigator.serviceWorker.ready.then(() => {
        offlineReady.value = true;
      });
  },
  onRegisterError: () => {
    pwaError.value = true;
  },
});
