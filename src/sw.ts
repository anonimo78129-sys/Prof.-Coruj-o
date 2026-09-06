/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import firebaseConfig from '../firebase-applet-config.json';

declare const self: ServiceWorkerGlobalScope;

// ─────────────────────────────────────────────────────────────────────────────
// v2.0.0 — SEM PRECACHE.
//
// Antes este service worker pré-cacheava 15,7 MB e servia o index.html a partir
// do cache. Isso custava caro e quebrava atualizações: depois de cada deploy o
// SW antigo entregava um index.html velho apontando para bundles que já tinham
// mudado, e o app abria em branco até o usuário limpar o cache na mão.
//
// O app não funciona offline de verdade de qualquer jeito — todo recurso de IA
// depende do Gemini e a sincronização depende do Firestore (que tem persistência
// offline própria, independente daqui). Então o precache pagava o preço de
// atualizações quebradas sem entregar offline de verdade.
//
// O service worker continua existindo por dois motivos que não dão pra abrir
// mão: notificações push do FCM em background e a instalabilidade do PWA
// ("adicionar à tela inicial"), que o Chrome só oferece se houver um SW com
// handler de fetch registrado.
// ─────────────────────────────────────────────────────────────────────────────

// Ativa a versão nova imediatamente: sem skipWaiting o SW atualizado ficava
// "waiting" até TODAS as abas fecharem, prendendo usuários na versão antiga.
self.skipWaiting();
clientsClaim();

// Com globPatterns: [] no vite.config.ts, o manifesto injetado aqui fica com uma
// única entrada de 0 KB: o manifest.json, que vem do includeAssets. O index.html
// e os bundles ficam de fora — é isso que importa, porque era o index.html vindo
// do cache que quebrava as atualizações.
//
// Manter a chamada, em vez de apagá-la, resolve duas coisas: o build do
// injectManifest exige a referência a self.__WB_MANIFEST, e o Workbox, ao
// comparar esse manifesto mínimo com o que está em cache, apaga sozinho os
// 15,7 MB de quem já tem a versão antiga instalada (medido: 112 arquivos e
// 15,4 MB caem para 1 arquivo e 0,1 MB na segunda abertura).
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Handler de fetch obrigatório para a instalabilidade do PWA. Não intercepta
// nada de propósito: sem respondWith, cada requisição segue direto para a rede,
// que é exatamente o comportamento que queremos agora.
self.addEventListener('fetch', () => { /* passa direto para a rede */ });

const NOTIF_ICON = '/assets/icons/notification.png';

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
