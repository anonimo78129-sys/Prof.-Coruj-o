// ─────────────────────────────────────────────────────────
// Compartilhamento da Batalha de Revisão (QuaqueMagia) por
// link/QR — sem backend. Mesmo mecanismo do jogo Escape
// (src/escape/game/quizShare.ts): as perguntas geradas viajam
// INTEIRAS dentro do link (#batalha=<codificado>), então quem
// abre/escaneia já entra com a batalha pronta, sem gastar IA.
// ─────────────────────────────────────────────────────────

export type BattleQuestion = { q: string; options: string[]; correct: number };

export interface SharedBattle {
  topic: string;
  questions: BattleQuestion[];
}

// Formato compacto que vai no link (tuplas em vez de objetos, p/ economizar)
type QTuple = [string, string[], number];   // [enunciado, alternativas, correta]
interface PayloadV1 { v: 1; t: string; q: QTuple[] }

// base64 seguro para UTF-8 e para URL (sem + / =)
function toB64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

/** Codifica a batalha numa string curta para colocar no link. */
export function encodeBattle(battle: SharedBattle): string {
  const payload: PayloadV1 = {
    v: 1,
    t: battle.topic,
    q: battle.questions.map(x => [x.q, x.options, x.correct] as QTuple),
  };
  return toB64Url(JSON.stringify(payload));
}

/** Decodifica a string do link de volta para uma batalha (null se inválida). */
export function decodeBattle(str: string): SharedBattle | null {
  try {
    const p = JSON.parse(fromB64Url(str)) as PayloadV1;
    if (!p || p.v !== 1 || !Array.isArray(p.q)) return null;
    const questions = p.q
      .filter(t => Array.isArray(t) && typeof t[0] === 'string' && Array.isArray(t[1]) && t[1].length === 4)
      .map(([q, options, correct]) => ({
        q,
        options: options.slice(0, 4).map(String),
        correct: Math.max(0, Math.min(3, Number(correct) || 0)),
      }));
    if (!questions.length) return null;
    return { topic: typeof p.t === 'string' ? p.t : '', questions };
  } catch {
    return null;
  }
}

/** Monta a URL de compartilhamento completa a partir de uma batalha. */
export function battleShareUrl(battle: SharedBattle, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');
  return `${base}#batalha=${encodeBattle(battle)}`;
}
