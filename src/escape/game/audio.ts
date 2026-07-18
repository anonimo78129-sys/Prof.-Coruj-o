// ─────────────────────────────────────────────────────────
// Sistema de áudio — efeitos sonoros (SFX)
//
// • Tudo é OPCIONAL: se o arquivo não existir, simplesmente não toca
//   (o jogo continua funcionando com os tons sintetizados do StoryGame).
// • Mudo + volume: persistidos no localStorage, com botão na interface.
//
// COMO ADICIONAR EFEITOS
//   public/escape-assets/audio/sfx/<nome>.mp3   (curtos, < 2s)
//   Os nomes esperados estão no mapa SFX_FILES abaixo.
// ─────────────────────────────────────────────────────────

// ── Preferências (mudo + volume), persistidas ──
const LS_MUTED = 'jb-audio-muted';
const LS_VOL = 'jb-audio-volume';

function readMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LS_MUTED) === '1';
}
function readVolume(): number {
  if (typeof localStorage === 'undefined') return 0.7;
  const v = parseFloat(localStorage.getItem(LS_VOL) ?? '');
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
}

let _muted = readMuted();
let _volume = readVolume();
const listeners = new Set<() => void>();

function notify() { listeners.forEach(fn => fn()); }

export function subscribeAudio(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isMuted(): boolean { return _muted; }
export function getVolume(): number { return _volume; }

export function setMuted(m: boolean) {
  _muted = m;
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_MUTED, m ? '1' : '0');
  notify();
}
export function toggleMuted() { setMuted(!_muted); }

export function setVolume(v: number) {
  _volume = Math.min(1, Math.max(0, v));
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_VOL, String(_volume));
  notify();
}

// O StoryGame consulta isto para silenciar também os tons sintetizados.
export function audioGain(base: number): number {
  return _muted ? 0 : base * _volume;
}

// ─────────────────────────────────────────────────────────
// Efeitos sonoros (SFX)
// ─────────────────────────────────────────────────────────
export type SfxName =
  | 'tap'        // toque/avançar diálogo
  | 'correct'    // acerto
  | 'wrong'      // erro
  | 'gate'       // portão/pedra abrindo
  | 'walk'       // passo
  | 'attack'     // ataque do jogador (combate)
  | 'hurt'       // jogador leva dano
  | 'victory'    // vitória
  | 'select';    // clique de botão/opção

const SFX_FILES: Record<SfxName, string> = {
  tap:     '/escape-assets/audio/sfx/tap.mp3',
  correct: '/escape-assets/audio/sfx/correct.mp3',
  wrong:   '/escape-assets/audio/sfx/wrong.mp3',
  gate:    '/escape-assets/audio/sfx/gate.mp3',
  walk:    '/escape-assets/audio/sfx/walk.mp3',
  attack:  '/escape-assets/audio/sfx/attack.mp3',
  hurt:    '/escape-assets/audio/sfx/hurt.mp3',
  victory: '/escape-assets/audio/sfx/victory.mp3',
  select:  '/escape-assets/audio/sfx/select.mp3',
};

// ─────────────────────────────────────────────────────────
// Sintetizador 8-bit (fallback) — toca quando o .mp3 não existe.
// Sons curtos estilo chiptune gerados via WebAudio.
// ─────────────────────────────────────────────────────────
let _sctx: AudioContext | null = null;
function synthCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!_sctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      _sctx = new AC();
    }
    if (_sctx.state === 'suspended') void _sctx.resume();
    return _sctx;
  } catch { return null; }
}

// tom com envelope; delay/freqEnd para arpejos e sweeps; detune (cents)
// permite empilhar uma 2ª voz levemente desafinada (dá corpo ao som)
function sTone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, freqEnd?: number, detune = 0) {
  const g0 = audioGain(gain); if (g0 <= 0) return;
  const ctx = synthCtx(); if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.detune.setValueAtTime(detune, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(g0, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// duas vozes levemente destonadas tocando juntas — chorus simples, dá "corpo"
function sToneDuo(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, freqEnd?: number) {
  sTone(freq, dur, type, gain, delay, freqEnd, -6);
  sTone(freq, dur, type, gain * 0.8, delay, freqEnd, 7);
}

// rajada de ruído filtrado (passos, impactos, texturas) — lowpass por padrão,
// mas aceita bandpass/highpass p/ ticks e rangidos
function sNoise(dur: number, gain: number, filterFreq: number, delay = 0, filterType: BiquadFilterType = 'lowpass') {
  const g0 = audioGain(gain); if (g0 <= 0) return;
  const ctx = synthCtx(); if (!ctx) return;
  const t = ctx.currentTime + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType; filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(g0, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(ctx.destination);
  src.start(t); src.stop(t + dur + 0.02);
}

// Efeitos sonoros originais do jogo — compostos em camadas (tom + ruído +
// segunda voz destonada) para soar mais rico que um bipe único, sem
// depender de nenhum arquivo de terceiros.
const SYNTH_SFX: Record<SfxName, (vol: number) => void> = {
  tap: v => {
    sTone(880, 0.045, 'square', 0.085 * v);
    sTone(660, 0.05, 'triangle', 0.05 * v, 0.01);
  },
  select: v => {
    sNoise(0.012, 0.05 * v, 3500, 0, 'highpass');
    sTone(660, 0.05, 'square', 0.09 * v);
    sTone(990, 0.07, 'square', 0.08 * v, 0.05);
  },
  correct: v => {
    [523.25, 659.25, 783.99].forEach((f, i) => sTone(f, 0.12, 'square', 0.10 * v, i * 0.075));
    sToneDuo(1046.5, 0.22, 'triangle', 0.07 * v, 0.225);
  },
  wrong: v => {
    sNoise(0.05, 0.05 * v, 1200);
    sTone(233, 0.16, 'sawtooth', 0.09 * v);
    sTone(196, 0.22, 'sawtooth', 0.08 * v, 0.11, 147);
  },
  gate: v => {
    sNoise(0.5, 0.045 * v, 380, 0, 'bandpass');
    sTone(85, 0.55, 'triangle', 0.13 * v, 0, 42);
    sTone(52, 0.18, 'sine', 0.12 * v, 0.5);
  },
  walk: v => sNoise(0.055, 0.045 * v, 700 + Math.random() * 300),
  attack: v => {
    sTone(880, 0.03, 'square', 0.05 * v);
    sTone(760, 0.14, 'square', 0.11 * v, 0, 130);
    sTone(1200, 0.05, 'sine', 0.04 * v, 0.02);
  },
  hurt: v => {
    sNoise(0.09, 0.09 * v, 500);
    sTone(180, 0.18, 'sawtooth', 0.09 * v, 0, 70);
    sTone(90, 0.22, 'sawtooth', 0.06 * v, 0.05);
  },
  victory: v => {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => sTone(f, 0.15, 'square', 0.09 * v, i * 0.105));
    [523.25, 659.25, 783.99, 1046.5].forEach(f => sToneDuo(f, 0.5, 'triangle', 0.05 * v, 0.46));
  },
};

// Cache de "disponibilidade": evita tentar recarregar arquivos que faltam.
const sfxAvailable = new Map<SfxName, boolean>();
const sfxCache = new Map<SfxName, HTMLAudioElement>();

export function playSfx(name: SfxName, vol = 1) {
  if (_muted || typeof Audio === 'undefined') return;
  if (sfxAvailable.get(name) === false) { SYNTH_SFX[name](vol); return; } // sem arquivo → 8-bit

  let base = sfxCache.get(name);
  if (!base) {
    base = new Audio(SFX_FILES[name]);
    base.preload = 'auto';
    base.addEventListener('error', () => sfxAvailable.set(name, false), { once: true });
    sfxCache.set(name, base);
  }
  // clona para permitir sobreposição (vários disparos rápidos)
  const node = base.cloneNode(true) as HTMLAudioElement;
  node.volume = Math.min(1, Math.max(0, vol * _volume));
  node.play().then(() => sfxAvailable.set(name, true)).catch(() => {
    // arquivo ausente/bloqueado → marca e cai para o sintetizado
    sfxAvailable.set(name, false);
    SYNTH_SFX[name](vol);
  });
}

// Pré-carrega os efeitos (opcional; chamado após o 1º gesto do usuário).
export function preloadSfx() {
  if (typeof Audio === 'undefined') return;
  (Object.keys(SFX_FILES) as SfxName[]).forEach(name => {
    if (sfxCache.has(name)) return;
    const a = new Audio(SFX_FILES[name]);
    a.preload = 'auto';
    a.addEventListener('error', () => sfxAvailable.set(name, false), { once: true });
    sfxCache.set(name, a);
  });
}
