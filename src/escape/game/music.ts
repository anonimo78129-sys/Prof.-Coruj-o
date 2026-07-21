// ─────────────────────────────────────────────────────────
// Música de fundo — tema de exploração estilo pixel art (chiptune)
//
// • Sequenciador WebAudio: melodia quadrada suave + baixo triangular +
//   pad de acordes + "shaker" de ruído, em Dó maior pentatônica
//   (a mesma escala dos tons da floresta no StoryGame).
// • Loop de 8 compassos com eco (delay) para o clima de aventura/mistério.
// • Arquivo OPCIONAL tem prioridade: se existir
//   public/escape-assets/audio/music/explore.mp3, ele toca em loop no lugar.
// • Respeita mudo/volume globais (subscribeAudio).
// • startMusic() deve ser chamado a partir de um gesto do usuário
//   (clique em JOGAR/CONTINUAR) por causa da política de autoplay.
// ─────────────────────────────────────────────────────────

import { audioGain, subscribeAudio } from './audio';

const MUSIC_FILE = '/escape-assets/audio/music/explore.mp3';
const MUSIC_GAIN = 0.32;         // volume-base da trilha (bem abaixo dos SFX)
const FILE_GAIN = 0.5;

// ── Tema da tela inicial (faixa própria, sempre que existir o arquivo) ──
const HOME_FILE = '/escape-assets/audio/music/home-theme.mp3';
const HOME_GAIN = 0.55;
const HOME_FADE_MS = 700;

// ── Tema de batalha (faixa própria, toca durante o combate) ──
const BATTLE_FILE = '/escape-assets/audio/music/battle.mp3';
const BATTLE_GAIN = 0.55;
const BATTLE_FADE_MS = 500;

const BPM = 96;
const STEP = 60 / BPM / 2;       // colcheia
const STEPS = 64;                // 8 compassos de 8 colcheias

// ── Notas (Hz) — Dó maior pentatônica + baixos ──
const C2 = 65.41, G2 = 98.0, A2 = 110.0, E2 = 82.41;
const C3 = 130.81, D3 = 146.83, E3 = 164.81, G3 = 196.0, A3 = 220.0;
const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392.0, A4 = 440.0;
const C5 = 523.25;
const _ = null;

// ── Partitura (64 passos por trilha) ──
// Melodia: frases curtas com respiros, terminando aberta para o loop.
const LEAD: Array<number | null> = [
  // c1            // c2            // c3            // c4
  E4,_,G4,_,A4,_,_,_,  G4,_,E4,_,D4,_,C4,_,  E4,_,G4,_,A4,_,C5,_,  A4,_,G4,_,E4,_,_,_,
  // c5            // c6            // c7            // c8
  C5,_,A4,_,G4,_,E4,_,  D4,_,E4,_,G4,_,_,_,  E4,_,D4,_,C4,_,A3,_,  C4,_,_,_,_,_,_,_,
];

// Baixo: fundamento no 1º e 5º passo de cada compasso (I–V–vi–V)
const BASS_ROOTS = [C2, G2, A2, G2, C2, G2, A2, E2];

// Pad: um acorde suave a cada 2 compassos
const PAD_CHORDS: number[][] = [[C3, G3], [A2, E3], [C3, G3], [G2, D3]];

// ── Estado ──
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let delaySend: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextTime = 0;
let running = false;

let fileEl: HTMLAudioElement | null = null;
let mode: 'unknown' | 'file' | 'synth' = 'unknown';

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = audioGain(MUSIC_GAIN);
      master.connect(ctx.destination);

      // eco suave (colcheia pontuada) — o "ar" da floresta
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = STEP * 3;
      const feedback = ctx.createGain(); feedback.gain.value = 0.28;
      const wet = ctx.createGain(); wet.gain.value = 0.22;
      delaySend = ctx.createGain();
      delaySend.connect(delay);
      delay.connect(feedback); feedback.connect(delay);
      delay.connect(wet); wet.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

// nota com envelope; echo = manda também para o delay
function note(freq: number, t: number, dur: number, type: OscillatorType, gain: number, opts?: { echo?: boolean; lowpass?: number; attack?: number }) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const attack = opts?.attack ?? 0.015;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let out: AudioNode = g;
  if (opts?.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = opts.lowpass;
    g.connect(f); out = f;
  }
  osc.connect(g);
  out.connect(master);
  if (opts?.echo && delaySend) out.connect(delaySend);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// tick de ruído bem baixinho (shaker)
function shaker(t: number, gain: number) {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.05);
}

function scheduleStep(s: number, t: number) {
  const bar = Math.floor(s / 8);
  const inBar = s % 8;

  // melodia (quadrada suave, filtrada, com eco)
  const m = LEAD[s];
  if (m) note(m, t, STEP * 1.7, 'square', 0.045, { echo: true, lowpass: 1400 });

  // baixo (triangular): fundamental no início e meio do compasso
  if (inBar === 0) note(BASS_ROOTS[bar], t, STEP * 3.4, 'triangle', 0.085);
  if (inBar === 4) note(BASS_ROOTS[bar], t, STEP * 2.6, 'triangle', 0.07);
  if (inBar === 6 && bar % 2 === 1) note(BASS_ROOTS[bar] * 2, t, STEP * 1.4, 'triangle', 0.05);

  // pad: acorde sustentado a cada 2 compassos (ataque lento)
  if (inBar === 0 && bar % 2 === 0) {
    for (const f of PAD_CHORDS[(bar / 2) % PAD_CHORDS.length]) {
      note(f, t, STEP * 15, 'sine', 0.028, { attack: 0.6 });
    }
  }

  // shaker nos contratempos (pula o último compasso p/ respirar)
  if (inBar % 4 === 2 && bar !== 7) shaker(t, 0.012);
}

function tick() {
  if (!ctx || !running) return;
  while (nextTime < ctx.currentTime + 0.12) {
    scheduleStep(step % STEPS, nextTime);
    step++;
    nextTime += STEP;
  }
}

function startSynth() {
  const c = ensureCtx(); if (!c || running) return;
  running = true;
  step = 0;
  nextTime = c.currentTime + 0.06;
  if (master) master.gain.setTargetAtTime(audioGain(MUSIC_GAIN), c.currentTime, 0.3);
  timer = setInterval(tick, 30);
}

/** Inicia a trilha (chamar a partir de um clique/gesto do usuário). */
export function startMusic() {
  if (running || (fileEl && !fileEl.paused)) return;

  // arquivo opcional tem prioridade sobre o sintetizado
  if (mode === 'synth') { startSynth(); return; }
  if (mode === 'file' && fileEl) {
    fileEl.volume = audioGain(FILE_GAIN);
    void fileEl.play().catch(() => {/* bloqueado — tenta de novo no próximo gesto */});
    return;
  }
  // primeira vez: tenta o arquivo; se não existir, cai para o chiptune
  if (typeof Audio === 'undefined') return;
  fileEl = new Audio(MUSIC_FILE);
  fileEl.loop = true;
  fileEl.preload = 'auto';
  fileEl.volume = audioGain(FILE_GAIN);
  fileEl.play()
    .then(() => { mode = 'file'; })
    .catch(() => { mode = 'synth'; fileEl = null; startSynth(); });
}

/** Para a trilha com um fade curto. */
export function stopMusic() {
  if (fileEl && !fileEl.paused) fileEl.pause();
  if (!running) return;
  running = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (ctx && master) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
}

// ─────────────────────────────────────────────────────────
// Tema da tela inicial — faixa própria (home-theme.mp3), com fade in/out.
// Chamado a partir de um clique/toque (ou de um listener de "primeiro
// gesto"), já que autoplay puro é bloqueado pelos navegadores.
// ─────────────────────────────────────────────────────────
let homeEl: HTMLAudioElement | null = null;
let homeFade: ReturnType<typeof setInterval> | null = null;

function clearHomeFade() {
  if (homeFade) { clearInterval(homeFade); homeFade = null; }
}

export function startHomeTheme() {
  if (typeof Audio === 'undefined') return;
  if (!homeEl) {
    homeEl = new Audio(HOME_FILE);
    homeEl.loop = true;
    homeEl.preload = 'auto';
    homeEl.volume = 0;
  }
  if (!homeEl.paused) return;
  clearHomeFade();
  const target = audioGain(HOME_GAIN);
  void homeEl.play().then(() => {
    if (!homeEl) return;
    const steps = 20;
    let i = 0;
    homeFade = setInterval(() => {
      i++;
      if (!homeEl) { clearHomeFade(); return; }
      homeEl.volume = Math.min(target, (target * i) / steps);
      if (i >= steps) clearHomeFade();
    }, HOME_FADE_MS / steps);
  }).catch(() => {/* bloqueado — tenta de novo no próximo gesto */});
}

export function stopHomeTheme() {
  if (!homeEl || homeEl.paused) return;
  clearHomeFade();
  const el = homeEl;
  const startVol = el.volume;
  const steps = 14;
  let i = 0;
  homeFade = setInterval(() => {
    i++;
    el.volume = Math.max(0, startVol * (1 - i / steps));
    if (i >= steps) { clearHomeFade(); el.pause(); }
  }, HOME_FADE_MS / 2 / steps);
}

// ─────────────────────────────────────────────────────────
// Tema de batalha — faixa própria (battle.mp3), toca durante o combate.
// A trilha de exploração (arquivo ou chiptune) é pausada enquanto isso
// e retomada de onde parou (ou reinicia o loop, no caso do chiptune)
// assim que a batalha termina.
// ─────────────────────────────────────────────────────────
let battleEl: HTMLAudioElement | null = null;
let battleFade: ReturnType<typeof setInterval> | null = null;
let duckedMusic = false; // a trilha de exploração estava tocando e foi pausada pela batalha

function clearBattleFade() {
  if (battleFade) { clearInterval(battleFade); battleFade = null; }
}

export function startBattleMusic() {
  const wasActive = running || !!(fileEl && !fileEl.paused);
  if (wasActive) { stopMusic(); duckedMusic = true; }

  if (typeof Audio === 'undefined') return;
  if (!battleEl) {
    battleEl = new Audio(BATTLE_FILE);
    battleEl.loop = true;
    battleEl.preload = 'auto';
    battleEl.volume = 0;
  }
  if (!battleEl.paused) return;
  clearBattleFade();
  const target = audioGain(BATTLE_GAIN);
  void battleEl.play().then(() => {
    if (!battleEl) return;
    const steps = 16;
    let i = 0;
    battleFade = setInterval(() => {
      i++;
      if (!battleEl) { clearBattleFade(); return; }
      battleEl.volume = Math.min(target, (target * i) / steps);
      if (i >= steps) clearBattleFade();
    }, BATTLE_FADE_MS / steps);
  }).catch(() => {/* bloqueado/arquivo ausente — o combate segue sem trilha própria */});
}

export function stopBattleMusic() {
  if (battleEl && !battleEl.paused) {
    clearBattleFade();
    const el = battleEl;
    const startVol = el.volume;
    const steps = 12;
    let i = 0;
    battleFade = setInterval(() => {
      i++;
      el.volume = Math.max(0, startVol * (1 - i / steps));
      if (i >= steps) { clearBattleFade(); el.pause(); }
    }, BATTLE_FADE_MS / steps);
  }
  // retoma a trilha de exploração de onde parou
  if (duckedMusic) {
    duckedMusic = false;
    if (mode === 'file' && fileEl) void fileEl.play().catch(() => {});
    else if (mode === 'synth') startSynth();
    else startMusic();
  }
}

// mudo/volume globais afetam as trilhas em tempo real
subscribeAudio(() => {
  if (ctx && master && running) master.gain.setTargetAtTime(audioGain(MUSIC_GAIN), ctx.currentTime, 0.1);
  if (fileEl) fileEl.volume = audioGain(FILE_GAIN);
  if (homeEl && !homeEl.paused && !homeFade) homeEl.volume = audioGain(HOME_GAIN);
  if (battleEl && !battleEl.paused && !battleFade) battleEl.volume = audioGain(BATTLE_GAIN);
});
