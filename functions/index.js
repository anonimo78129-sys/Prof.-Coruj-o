/**
 * Cloud Functions — Prof. Corujão
 *
 * Envia lembretes de aula via FCM (push) ~30 minutos antes de cada aula,
 * mesmo com o app fechado. Roda a cada 15 minutos e, para cada professor
 * com tokens registrados, verifica se alguma aula começa na janela de
 * [30, 45) minutos a partir de agora (no fuso do professor).
 *
 * A janela de 15 min com cadência de 15 min garante que cada aula seja
 * notificada exatamente uma vez.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { GoogleGenAI } = require('@google/genai');

initializeApp();

// O Firestore deste projeto usa um database nomeado (não o "(default)").
const DATABASE_ID = 'ai-studio-cd641469-33cc-4791-8019-1268615bcbc5';
const db = getFirestore(DATABASE_ID);

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Retorna o dia da semana (0-6) e os minutos desde a meia-noite no fuso dado.
function getLocalNow(timezone) {
  const now = new Date();
  let tz = timezone || 'America/Sao_Paulo';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch (e) {
    // Fuso inválido — cai para São Paulo.
    tz = 'America/Sao_Paulo';
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  let day = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') day = WEEKDAY[p.value] ?? 0;
    else if (p.type === 'hour') hour = parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
  }
  // Chave de data local (YYYY-MM-DD) para compor a tag da notificação.
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return { day, minutes: hour * 60 + minute, dateKey };
}

exports.sendClassReminders = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
    retryCount: 0,
  },
  async () => {
    // 1) Coleta todos os tokens (collectionGroup) e agrupa por professor.
    const tokensSnap = await db.collectionGroup('fcmTokens').get();
    if (tokensSnap.empty) {
      logger.info('Nenhum token FCM registrado.');
      return;
    }

    /** @type {Map<string, { tokens: { token: string, ref: FirebaseFirestore.DocumentReference }[], timezone: string }>} */
    const byUser = new Map();
    for (const docSnap of tokensSnap.docs) {
      const data = docSnap.data() || {};
      // O caminho é users/{uid}/fcmTokens/{token} → o uid é o avô do doc.
      const uid = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : data.uid;
      if (!uid) continue;
      const token = data.token || docSnap.id;
      if (!token) continue;
      if (!byUser.has(uid)) {
        byUser.set(uid, { tokens: [], timezone: data.timezone || 'America/Sao_Paulo' });
      }
      const entry = byUser.get(uid);
      entry.tokens.push({ token, ref: docSnap.ref });
      if (data.timezone) entry.timezone = data.timezone;
    }

    let totalSent = 0;

    // 2) Para cada professor, verifica as aulas de hoje no fuso dele.
    await Promise.all(
      Array.from(byUser.entries()).map(async ([uid, info]) => {
        const local = getLocalNow(info.timezone);
        const schedSnap = await db.collection(`users/${uid}/schedules`).get();
        if (schedSnap.empty) return;

        const messages = [];
        for (const s of schedSnap.docs) {
          const sched = s.data() || {};
          if (!Array.isArray(sched.days) || !sched.days.includes(local.day)) continue;
          if (!sched.time || typeof sched.time !== 'string') continue;
          const [h, m] = sched.time.split(':').map((n) => parseInt(n, 10));
          if (Number.isNaN(h) || Number.isNaN(m)) continue;
          const classMin = h * 60 + m;
          const diff = classMin - local.minutes;
          // Notifica ~30 min antes (janela de 15 min => uma vez por aula).
          if (diff >= 30 && diff < 45) {
            const subject = sched.subject ? `${sched.subject} — ` : '';
            messages.push({
              title: 'Aula em 30 minutos',
              body: `${subject}${sched.name || 'Aula'} às ${sched.time}`,
              tag: `aula-${s.id}-${local.dateKey}`,
            });
          }
        }

        if (messages.length === 0) return;

        const tokens = info.tokens.map((t) => t.token);
        const messaging = getMessaging();

        for (const msg of messages) {
          const resp = await messaging.sendEachForMulticast({
            tokens,
            data: { title: msg.title, body: msg.body, tag: msg.tag, url: '/' },
            android: { priority: 'high' },
            webpush: { headers: { Urgency: 'high' } },
          });
          totalSent += resp.successCount;

          // 3) Limpa tokens inválidos/expirados.
          const toDelete = [];
          resp.responses.forEach((r, i) => {
            if (!r.success) {
              const code = r.error && r.error.code;
              if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-argument' ||
                code === 'messaging/invalid-registration-token'
              ) {
                toDelete.push(info.tokens[i].ref);
              }
            }
          });
          await Promise.all(toDelete.map((ref) => ref.delete().catch(() => {})));
        }
      })
    );

    logger.info(`Lembretes enviados: ${totalSent}`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Proxy de geração de IA (Gemini)
//
// A chave do Gemini vive SÓ no servidor (secret GEMINI_API_KEY). O cliente nunca
// a vê — todas as gerações passam por aqui, exigindo usuário autenticado.
//
// A cota do plano free é a fonte da verdade em `usage/{uid}` — coleção que as
// regras do Firestore tornam ilegível-para-escrita ao cliente, então não pode
// ser zerada por delete+recreate do próprio documento (era o bypass do achado #3).
// Espelhamos o contador em `users/{uid}` apenas para exibição/painel admin.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const FREE_GENERATION_LIMIT = 10;
const ADMIN_EMAILS = ['lyelsonmf520@gmail.com'];
const AI_MODEL = 'gemini-2.5-flash';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retenta o Gemini no servidor (503 sobrecarga / 429 cota-por-minuto), de modo
// que o cliente faça uma única chamada e a cota só seja debitada em caso de
// sucesso — sem risco de debitar duas vezes por retentativas de rede.
async function callGeminiWithRetry(ai, params, maxRetries = 4) {
  let attempt = 0;
  let rl429 = 0;
  while (attempt < maxRetries) {
    try {
      return await ai.models.generateContent(params);
    } catch (error) {
      attempt++;
      const msg = (error && (error.message || String(error))) || '';
      const status = (error && (error.status || (error.error && error.error.code))) || null;
      const is503 = status === 503 || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
      const is429 = status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      if (is429 && rl429 < 1) { rl429++; await sleep(30000); continue; }
      if (is503 && attempt < maxRetries) { await sleep(2000 * Math.pow(2, attempt - 1) + Math.random() * 1000); continue; }
      throw error;
    }
  }
  throw new Error('UNAVAILABLE: servidor da IA indisponível após várias tentativas.');
}

exports.generateAi = onCall(
  { secrets: [GEMINI_API_KEY], timeoutSeconds: 120, memory: '512MiB', region: 'us-central1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Faça login para usar a IA.');

    const data = request.data || {};
    const { model, contents, config, billable } = data;
    if (!contents) throw new HttpsError('invalid-argument', 'Requisição de IA inválida.');

    const email = ((request.auth.token && request.auth.token.email) || '').toLowerCase();
    const userRef = db.doc(`users/${uid}`);
    const usageRef = db.doc(`usage/${uid}`);
    const [userSnap, usageSnap] = await Promise.all([userRef.get(), usageRef.get()]);
    const user = userSnap.exists ? (userSnap.data() || {}) : {};
    const privileged = user.isPro === true || user.role === 'admin' || ADMIN_EMAILS.includes(email);

    // Fonte da verdade da cota: usage/{uid}. Na primeira vez, migra do valor
    // que existir em users/{uid} para não presentear resets aos usuários atuais.
    const used = usageSnap.exists
      ? (usageSnap.data().generationsUsed || 0)
      : (user.generationsUsed || 0);

    if (billable && !privileged && used >= FREE_GENERATION_LIMIT) {
      throw new HttpsError('resource-exhausted', 'FREE_LIMIT_REACHED');
    }

    let result;
    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
      result = await callGeminiWithRetry(ai, { model: model || AI_MODEL, contents, config });
    } catch (error) {
      const msg = (error && (error.message || String(error))) || 'Erro na IA';
      // Preserva os tokens de status (503/UNAVAILABLE/429) para o cliente mapear.
      throw new HttpsError('unavailable', msg);
    }

    const usage = result.usageMetadata || {};
    const inTok = usage.promptTokenCount || 0;
    const outTok = usage.candidatesTokenCount || 0;
    const countThis = !!billable && !privileged;

    // Contabilização atômica (best-effort — nunca falha a resposta ao usuário).
    try {
      const writes = [];

      // usage/{uid}: contador à prova de adulteração.
      if (countThis) {
        writes.push(
          usageSnap.exists
            ? usageRef.set({ generationsUsed: FieldValue.increment(1) }, { merge: true })
            : usageRef.set({ generationsUsed: (user.generationsUsed || 0) + 1 }, { merge: true })
        );
      }

      // users/{uid}: espelho para exibição + tokens (métrica de custo do admin).
      const userUpdate = {
        inputTokens: FieldValue.increment(inTok),
        outputTokens: FieldValue.increment(outTok),
      };
      if (countThis) userUpdate.generationsUsed = used + 1;
      writes.push(userRef.set(userUpdate, { merge: true }));

      // Estatísticas globais (o cliente não conseguia escrever aqui — achado #7).
      const monthKey = new Date().toISOString().slice(0, 7).replace('-', '_');
      const statsPayload = {
        totalGenerations: FieldValue.increment(1),
        totalInputTokens: FieldValue.increment(inTok),
        totalOutputTokens: FieldValue.increment(outTok),
      };
      writes.push(db.doc('config/stats').set(statsPayload, { merge: true }));
      writes.push(db.doc(`config/stats_${monthKey}`).set(statsPayload, { merge: true }));

      await Promise.all(writes);
    } catch (e) {
      logger.warn('Falha ao contabilizar geração (resposta segue normalmente):', e);
    }

    let functionCalls = null;
    try { functionCalls = result.functionCalls || null; } catch (e) { functionCalls = null; }

    return { text: result.text || '', functionCalls };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Proxy de busca de imagens (Pixabay)
//
// Mantém a PIXABAY_API_KEY fora do bundle público (achado #5). É opcional, então
// usamos defineString (default '') para não travar o deploy quando não definida.
// Retorna só os campos de URL que o cliente consome.
// ─────────────────────────────────────────────────────────────────────────────

const PIXABAY_API_KEY = defineString('PIXABAY_API_KEY', { default: '' });

exports.pixabaySearch = onCall(
  { timeoutSeconds: 20, memory: '256MiB', region: 'us-central1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login necessário.');

    const key = PIXABAY_API_KEY.value();
    if (!key) return { hits: [] };

    const d = request.data || {};
    const q = String(d.query || '').replace(/,/g, ' ').trim();
    if (!q) return { hits: [] };

    const params = new URLSearchParams({
      key,
      q,
      image_type: d.imageType === 'illustration' ? 'illustration' : 'photo',
      safesearch: 'true',
      orientation: 'horizontal',
      per_page: '20',
    });
    if (d.minWidth) params.set('min_width', String(Math.min(Number(d.minWidth) || 0, 1280)));
    if (d.order) params.set('order', String(d.order));

    try {
      const res = await fetch(`https://pixabay.com/api/?${params.toString()}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { hits: [] };
      const data = await res.json();
      const hits = (data.hits || [])
        .slice(0, 10)
        .map((h) => ({ webformatURL: h.webformatURL || '', largeImageURL: h.largeImageURL || '' }));
      return { hits };
    } catch (e) {
      logger.warn('Falha na busca do Pixabay:', e);
      return { hits: [] };
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Exclusão dos dados do usuário mantidos só pelo backend (LGPD art. 18, VI)
//
// O contador de cota vive em `usage/{uid}`, que as regras tornam ilegível-para-
// escrita ao cliente. Na exclusão de conta o cliente não consegue apagá-lo, então
// esta callable (autenticada, sempre no próprio uid) faz essa limpeza.
// ─────────────────────────────────────────────────────────────────────────────

exports.deleteUserData = onCall(
  { region: 'us-central1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Login necessário.');
    try {
      await db.doc(`usage/${uid}`).delete();
    } catch (e) {
      logger.warn('Falha ao apagar usage do usuário:', e);
    }
    return { ok: true };
  }
);
