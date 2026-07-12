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
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

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
