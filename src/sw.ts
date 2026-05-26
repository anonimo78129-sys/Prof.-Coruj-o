/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import firebaseConfig from '../firebase-applet-config.json';

declare const self: ServiceWorkerGlobalScope;

// v1.1.0 — limpa caches antigos e registra novos assets
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const NOTIF_ICON = 'https://i.ibb.co/9mG1MVP1/20260417-114358-0000.png';

// ── FCM: notificações push em background (app fechado) ──────────────────────
// Recebemos mensagens "data-only" do servidor e exibimos manualmente para ter
// controle total e evitar notificação duplicada.
try {
  const fbApp = initializeApp(firebaseConfig);
  const messaging = getMessaging(fbApp);
  onBackgroundMessage(messaging, (payload) => {
    const data = payload.data || {};
    const title = data.title || 'Prof. Corujão';
    const body = data.body || '';
    self.registration.showNotification(title, {
      body,
      icon: NOTIF_ICON,
      tag: data.tag || undefined,
      requireInteraction: false,
      data: { url: data.url || '/' },
    });
  });
} catch (e) {
  // Sem chave VAPID ou ambiente sem suporte — segue sem push.
}

// Abre/foca o app ao tocar em uma notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});
