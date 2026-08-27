// ─────────────────────────────────────────────────────────────────────────────
// Utilidades puras do Prof. Corujão — sem React, sem Firebase, sem estado.
// Primeiro passo da modularização do App.tsx: tudo aqui é testável isolado.
// ─────────────────────────────────────────────────────────────────────────────

// Escapa texto para interpolação segura em HTML gerado (impressões).
// Conteúdo vindo da IA ou digitado pelo usuário NUNCA deve entrar cru em document.write.
export const escapeHtml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Embaralhamento Fisher–Yates — sort(() => Math.random() - 0.5) é enviesado.
export const shuffleArray = <T,>(arr: readonly T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── Contas administradoras (bootstrap) ──────────────────────────────────────
// A autorização real é aplicada nas regras do Firestore/Storage; estas listas
// controlam apenas a exibição de recursos de admin no cliente.
export const ADMIN_BOOTSTRAP_EMAILS = ['lyelsonmf520@gmail.com'];
export const isAdminAccount = (profile: { role?: string } | null | undefined, user: { email?: string | null } | null | undefined): boolean =>
  profile?.role === 'admin' || ADMIN_BOOTSTRAP_EMAILS.includes((user?.email || '').toLowerCase());

// ── Mensagens de erro amigáveis para falhas da API de IA ────────────────────
export const formatApiError = (error: any, defaultMsg: string): string => {
  let msg = '';
  if (typeof error === 'string') {
    msg = error;
  } else if (error instanceof Error) {
    msg = error.message;
  } else if (error?.message) {
    msg = error.message;
  } else {
    try { msg = JSON.stringify(error); } catch { /* objeto não serializável */ }
  }

  if (msg.startsWith('[IA_FORMATO]')) {
    return 'A IA respondeu num formato inesperado. Toque em gerar de novo que normalmente resolve.';
  }
  if (msg.includes('FREE_LIMIT_REACHED')) {
    return 'Você usou todas as gerações gratuitas. Ative o Pro para continuar gerando sem limites.';
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    return 'Muita gente usando a IA agora. Já estou tentando de novo. Se continuar, aguarde 1 minuto.';
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Calma, professor! Muitas perguntas de uma vez. Aguarde alguns segundos e tente de novo.';
  }
  return defaultMsg;
};

// ── Formatação e arquivos ───────────────────────────────────────────────────
export const fmtBytes = (b: number) => {
  if (b < 1024)               return `${b} B`;
  if (b < 1024 * 1024)        return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// file.type pode vir vazio em alguns Androids; deduz pela extensão
export const guessMimeType = (file: File): string => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'application/pdf';
};

// ── Modelo de IA ────────────────────────────────────────────────────────────
// Fonte única do nome do modelo. Fica aqui, num arquivo sem dependência
// nenhuma, porque o App.tsx e o jogo Escape precisam do mesmo valor — e
// mantê-lo duplicado é como se esquece metade numa migração de modelo.
export const AI_MODEL = 'gemini-3.6-flash';

// ── Preços da API (exibição no painel admin) ────────────────────────────────
// Valores do gemini-3.6-flash em USD por 1M de tokens + câmbio de referência.
// ATENÇÃO: estes são os preços promocionais, válidos até 31/12/2026. A partir
// de 01/01/2027 passam a ser 1.50 (entrada) e 7.50 (saída) — o dobro.
// Fonte única: quando o preço mudar, atualize APENAS aqui.
export const AI_PRICING = {
  inputUsdPer1M: 0.75,
  outputUsdPer1M: 3.75,
  usdToBrl: 5.2,
};
export const estimateCostUSD = (inputTokens: number, outputTokens: number): number =>
  (inputTokens * AI_PRICING.inputUsdPer1M + outputTokens * AI_PRICING.outputUsdPer1M) / 1_000_000;
