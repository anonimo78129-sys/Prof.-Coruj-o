// ─────────────────────────────────────────────────────────
// Compartilhamento de quiz por link/QR — sem backend.
// O quiz do professor viaja INTEIRO dentro do link (codificado),
// então o aluno só precisa abrir/escanear para jogar. Não depende de
// Firestore, login nem conexão persistente.
// ─────────────────────────────────────────────────────────
import type { GameConfig, MCQuestion, MatchPair } from '../types/game';

// Só o que o jogo realmente usa (perguntas + pareamento). Mantido enxuto
// para o link caber num QR code.
export interface SharedQuiz {
  subject: string;
  level?: string;
  questions: MCQuestion[];   // pool geral (floresta + cavernas + batalhas)
  pairs: MatchPair[];        // pares para o pareamento (cidade)
}

// Formato compacto que vai no link (tuplas em vez de objetos, p/ economizar)
type QTuple = [string, string[], number];   // [enunciado, alternativas, correta]
type PTuple = [string, string];             // [conceito, definição]
interface PayloadV1 { v: 1; s: string; l?: string; q: QTuple[]; p: PTuple[] }

/** Extrai do GameConfig do professor só o necessário para jogar. */
export function quizFromConfig(cfg: GameConfig): SharedQuiz {
  const questions = [
    ...(cfg.scenes.forest?.questions ?? []),
    ...(cfg.scenes.caves?.questions ?? []),
    ...(cfg.scenes.tower?.questions ?? []),
  ].filter(q => q && q.text?.trim());
  return {
    subject: cfg.subject ?? '',
    level: cfg.level,
    questions,
    pairs: (cfg.scenes.city?.pairs ?? []).filter(p => p && p.concept?.trim() && p.definition?.trim()),
  };
}

// base64 seguro para UTF-8 e para URL (sem + / =)
function toB64Url(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

/** Codifica o quiz numa string curta para colocar no link. */
export function encodeQuiz(quiz: SharedQuiz): string {
  const payload: PayloadV1 = {
    v: 1,
    s: quiz.subject,
    ...(quiz.level ? { l: quiz.level } : {}),
    q: quiz.questions.map(x => [x.text, x.options, x.correct] as QTuple),
    p: quiz.pairs.map(x => [x.concept, x.definition] as PTuple),
  };
  return toB64Url(JSON.stringify(payload));
}

/** Decodifica a string do link de volta para um quiz (null se inválido). */
export function decodeQuiz(str: string): SharedQuiz | null {
  try {
    const p = JSON.parse(fromB64Url(str)) as PayloadV1;
    if (!p || p.v !== 1 || !Array.isArray(p.q)) return null;
    return {
      subject: typeof p.s === 'string' ? p.s : '',
      level: p.l,
      questions: p.q
        .filter(t => Array.isArray(t) && typeof t[0] === 'string' && Array.isArray(t[1]))
        .map(([text, options, correct]) => ({
          text,
          options: options.slice(0, 4) as MCQuestion['options'],
          correct: (Math.max(0, Math.min(3, Number(correct) || 0)) as MCQuestion['correct']),
        })),
      pairs: (Array.isArray(p.p) ? p.p : [])
        .filter(t => Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string')
        .map(([concept, definition]) => ({ concept, definition })),
    };
  } catch {
    return null;
  }
}

/** Monta a URL de compartilhamento completa a partir de um quiz. */
export function shareUrl(quiz: SharedQuiz, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');
  return `${base}#jogo=${encodeQuiz(quiz)}`;
}
