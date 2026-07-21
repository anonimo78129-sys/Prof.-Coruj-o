// ─────────────────────────────────────────────────────────
// Progresso do jogador — save/continuar + estatísticas
//
// • Checkpoint: salvo a cada beat no início do ato atual (beat 'scene').
//   "CONTINUAR" na tela inicial retoma do início do ato onde parou.
// • Estatísticas: erros e desafios resolvidos, usados na tela de
//   resultados ao final da jornada.
// Tudo em localStorage — sobrevive a fechar o app (é um PWA).
// ─────────────────────────────────────────────────────────

const LS_SAVE = 'jb-save';
const LS_STATS = 'jb-stats';

export interface SaveData {
  checkpoint: number;   // índice do beat 'scene' que inicia o ato
  at: string;           // ISO timestamp (informativo)
}

export interface Stats {
  errors: number;       // respostas erradas acumuladas
  solved: number;       // desafios completados
  ending: 'luz' | 'sombra' | null;
}

const EMPTY_STATS: Stats = { errors: 0, solved: 0, ending: null };

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* indisponível */ }
}

// ── Save/checkpoint ──
export function getSave(): SaveData | null {
  const s = readJson<SaveData>(LS_SAVE);
  return s && typeof s.checkpoint === 'number' && s.checkpoint > 0 ? s : null;
}
export function saveCheckpoint(checkpoint: number) {
  writeJson(LS_SAVE, { checkpoint, at: new Date().toISOString() } satisfies SaveData);
}
export function clearSave() {
  try { localStorage.removeItem(LS_SAVE); } catch { /* indisponível */ }
}

// ── Estatísticas ──
export function getStats(): Stats {
  return readJson<Stats>(LS_STATS) ?? { ...EMPTY_STATS };
}
export function resetStats() {
  writeJson(LS_STATS, EMPTY_STATS);
}
export function recordError() {
  const s = getStats();
  writeJson(LS_STATS, { ...s, errors: s.errors + 1 });
}
export function recordSolved() {
  const s = getStats();
  writeJson(LS_STATS, { ...s, solved: s.solved + 1 });
}
export function recordEnding(ending: 'luz' | 'sombra') {
  const s = getStats();
  writeJson(LS_STATS, { ...s, ending });
}

// ── Medalha pela jornada (menos erros = melhor) ──
export type Medal = 'ouro' | 'prata' | 'bronze';
export function medalFor(stats: Stats): Medal {
  if (stats.errors === 0) return 'ouro';
  if (stats.errors <= 3) return 'prata';
  return 'bronze';
}
