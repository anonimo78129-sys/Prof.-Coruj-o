import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Beat, SceneBg, Speaker } from '../../game/types';
import { buildBeats } from '../../game/buildBeats';
import type { SharedQuiz } from '../../game/quizShare';
import { audioGain, playSfx, preloadSfx } from '../../game/audio';
import { startBattleMusic, stopBattleMusic } from '../../game/music';
import LoreFx from './LoreFx';
import { saveCheckpoint, clearSave, recordError, recordSolved, recordEnding, getStats, medalFor } from '../../game/progress';

const FLOOR = 300;           // faixa reservada no rodapé p/ a caixa de texto e botões
const GROUND = 34;           // altura do chão dentro do mundo (acima da faixa FLOOR)
const HERO_LIFT = -5;        // ajuste fino vertical só do herói (acima do chão)
const GATE_AHEAD = 24;       // o portão para um pouco à frente de onde o herói chega
const WALK_SPEED = 230;      // px/seg que o herói anda

// ─────────────────────────────────────────────────────────
// Sistema de terreno — degraus e rampas
// ─────────────────────────────────────────────────────────
export type TerrainZone = {
  x: number;      // worldX onde a mudança começa
  y: number;      // offset do chão em px (positivo = mais alto)
  ramp?: number;  // se definido: comprimento da rampa em px (senão = degrau instantâneo)
};

// Zonas de terreno ativas no jogo (vazio por padrão; preencher via editor DEV)
export const TERRAIN_ZONES: TerrainZone[] = [
  { x: 219, y: -3 },
  { x: 304, y: 0 },
  { x: 410, y: -3 },
  { x: 536, y: 0 },
  { x: 640, y: -4 },
];

function getHeroGround(wx: number, zones: TerrainZone[]): number {
  if (!zones.length) return 0;
  const sorted = [...zones].sort((a, b) => a.x - b.x);
  let ground = 0;
  for (let i = 0; i < sorted.length; i++) {
    const z = sorted[i];
    if (wx < z.x) break;
    if (!z.ramp) {
      ground = z.y;
    } else {
      const prevY = i > 0 ? sorted[i - 1].y : 0;
      const t = Math.min(1, (wx - z.x) / z.ramp);
      ground = prevY + (z.y - prevY) * t;
    }
  }
  return ground;
}

// ─────────────────────────────────────────────────────────
// Áudio — "voz" da floresta (tons pentatônicos, sempre harmônicos)
// AudioContext criado preguiçosamente e retomado após um gesto do usuário.
// ─────────────────────────────────────────────────────────
let _actx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!_actx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      _actx = new AC();
    }
    if (_actx.state === 'suspended') void _actx.resume();
    return _actx;
  } catch { return null; }
}
function playTone(freq: number, dur = 0.5, type: OscillatorType = 'sine', gain = 0.16) {
  const g0 = audioGain(gain); if (g0 <= 0) return;   // respeita mudo/volume
  const ctx = audioCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type; osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(g0, t + 0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + dur + 0.05);
}
// Dó maior pentatônica (C D E G A) — qualquer combinação soa agradável
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0];
function playChord(freqs: number[], dur = 1.6, gain = 0.1) {
  freqs.forEach(f => playTone(f, dur, 'triangle', gain));
}

// Pré-carrega todas as imagens dos props/layers no início para
// evitar que apareçam "achatadas" ao entrar no viewport.
function ImagePreloader() {
  const srcs = [
    '/escape-assets/world/ground-dark.png',
    '/escape-assets/world/cloud1.png', '/escape-assets/world/cloud2.png', '/escape-assets/world/cloud3.png',
    '/escape-assets/world/gate-closed.png', '/escape-assets/world/gate-half.png', '/escape-assets/world/gate-open.png',
    '/escape-assets/tallforest/gate-closed.png', '/escape-assets/tallforest/gate-open.png',
    '/escape-assets/world/boulder.png',
    '/escape-assets/ato3/apple.png',
    '/escape-assets/ato3/estufa-ext.png', '/escape-assets/ato3/estufa-light.png',
    '/escape-assets/estufa/bg.jpg',
    '/escape-assets/estufa/reflect-1.png', '/escape-assets/estufa/reflect-2.png',
    '/escape-assets/estufa/trunk-1.png', '/escape-assets/estufa/trunk-2.png', '/escape-assets/estufa/trunk-3.png',
    '/escape-assets/estufa/computer-off.png', '/escape-assets/estufa/computer-on.png',
    '/escape-assets/pantano/bg.png',
    '/escape-assets/pantano/back-silh.png', '/escape-assets/pantano/hills.png', '/escape-assets/pantano/hills2.png', '/escape-assets/pantano/dead-trees.png',
    '/escape-assets/pantano/mix-trees.png', '/escape-assets/pantano/logs.png', '/escape-assets/pantano/ground-fg.png', '/escape-assets/pantano/soil.png',
    '/escape-assets/pantano/croc.png', '/escape-assets/pantano/frog1.png', '/escape-assets/pantano/frog2.png', '/escape-assets/pantano/lily.png',
    '/escape-assets/pantano/plant-tall.png', '/escape-assets/pantano/plant-bush.png',
    '/escape-assets/scenes/corredor.jpg', '/escape-assets/scenes/final.jpg',
    '/escape-assets/ato3/sky.png',
    '/escape-assets/ato3/mountain-back.png', '/escape-assets/ato3/mountain-front.png',
    '/escape-assets/ato3/tree-teal.png', '/escape-assets/ato3/trees-green.png',
    ...SCENERY.map(p => `/escape-assets/${p.src}`),
    ...FOREST_LAYERS.map(l => `/escape-assets/forest/${l.src}`),
    '/escape-assets/forest/Layer_0002_7_c.png',
    '/escape-assets/forest/Layer_0003_6_c.png',
    `/escape-assets/forest/${FOREST_FOREGROUND.src}`,
    '/escape-assets/tallforest/back.png', '/escape-assets/tallforest/far.png', '/escape-assets/tallforest/middle.png',
    '/escape-assets/chars/player-walk-1.png', '/escape-assets/chars/player-walk-2.png', '/escape-assets/chars/player-walk-3.png',
    '/escape-assets/chars/player-idle-1.png', '/escape-assets/chars/player-idle-2.png',
    '/escape-assets/chars/wakeup-1.png', '/escape-assets/chars/wakeup-2.png', '/escape-assets/chars/wakeup-3.png', '/escape-assets/chars/wakeup-4.png',
  ];
  return (
    <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {[...new Set(srcs)].map(src => <img key={src} src={src} alt="" />)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Moldura de madeira pixel art — estilo unificado de todos os painéis
// ─────────────────────────────────────────────────────────
const WOOD_PANEL: CSSProperties = {
  background: '#1a0e06',
  border: '4px solid #8b5e2e',
  boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
  imageRendering: 'pixelated',
};

// ─────────────────────────────────────────────────────────
// Ícones pixel art (substituem emojis na UI)
// ─────────────────────────────────────────────────────────
function PixelIcon({ kind, size = 18 }: { kind: 'sprout' | 'wilt' | 'seed' | 'lily'; size?: number }) {
  // Desenhados numa grade 12×12; shapeRendering mantém as bordas duras.
  const px = (x: number, y: number, w: number, h: number, fill: string) =>
    <rect key={`${x}-${y}-${fill}`} x={x} y={y} width={w} height={h} fill={fill} />;
  let cells: ReactNode[] = [];
  if (kind === 'sprout') {
    cells = [
      px(5, 7, 2, 4, '#3a7a2a'),                       // caule
      px(2, 4, 3, 3, '#4fae35'), px(3, 3, 2, 2, '#6fd04a'),  // folha esq
      px(7, 4, 3, 3, '#4fae35'), px(7, 3, 2, 2, '#6fd04a'),  // folha dir
      px(4, 10, 4, 1, '#5a3a1a'),                      // terra
    ];
  } else if (kind === 'wilt') {
    cells = [
      px(5, 6, 2, 5, '#5a4a3a'),                       // caule seco
      px(6, 5, 2, 2, '#5a4a3a'),                       // curvado
      px(7, 3, 3, 3, '#7a5a6a'), px(8, 2, 2, 2, '#8a6a7a'),  // flor murcha
      px(4, 10, 4, 1, '#3a3028'),                      // terra seca
    ];
  } else if (kind === 'seed') {
    cells = [
      px(4, 3, 4, 6, '#8a5a2a'), px(5, 2, 2, 2, '#6a4218'),   // corpo
      px(5, 4, 1, 3, '#c49054'),                       // brilho
      px(3, 5, 1, 3, '#6a4218'), px(8, 5, 1, 3, '#6a4218'),   // laterais
    ];
  } else { // lily — vitória-régia
    cells = [
      px(2, 6, 8, 3, '#2a8a3a'), px(3, 5, 6, 1, '#3aae4a'),   // folha redonda
      px(8, 6, 2, 1, '#1a6a2a'),                       // recorte
      px(5, 3, 2, 3, '#ffb0d0'), px(4, 4, 4, 1, '#ff90c0'),   // flor
      px(5, 4, 2, 1, '#ffe0f0'),                       // miolo
    ];
  }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {cells}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────
// Caixa de diálogo com efeito máquina de escrever
// ─────────────────────────────────────────────────────────
const SPEAKER_NAME: Record<Speaker, string> = {
  narrador: '',
  estudante: 'Estudante',
  corujao: 'Prof. Corujão',
  consciencia: 'Consciência Verde',
};

function DialogueBox({
  who, text, onNext, last,
}: { who: Speaker; text: string; onNext: () => void; last?: boolean }) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    setShown(''); setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, 28);
    return () => clearInterval(id);
  }, [text]);

  const tap = () => { if (!done) { setShown(text); setDone(true); } else { playSfx('tap'); onNext(); } };
  const name = SPEAKER_NAME[who];

  return (
    <div onPointerDown={(e) => { e.preventDefault(); tap(); }} onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 100, zIndex: 40, cursor: 'pointer' }}>
      <div style={{
          margin: '0 14px 18px', maxWidth: 760, marginLeft: 'auto', marginRight: 'auto',
          padding: '14px 18px',
          background: '#1a0e06',
          border: '4px solid #8b5e2e',
          boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
          imageRendering: 'pixelated',
          position: 'relative',
        }}>
        {(who === 'corujao' || who === 'estudante' || who === 'consciencia') && (
          <div style={{
            position: 'absolute', top: -60, left: 8,
            width: 68, height: 68,
            background: '#1a0e06',
            border: '3px solid #8b5e2e',
            boxShadow: 'inset 0 0 0 1px #c4874c, 0 0 0 1px #3a1f08',
            imageRendering: 'pixelated',
          }}>
            <img
              src={who === 'corujao' ? '/escape-assets/portraits/owl.png' : who === 'estudante' ? '/escape-assets/portraits/hero.png' : '/escape-assets/portraits/consciencia.png'}
              alt=""
              style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
            />
          </div>
        )}
        {name && (
          <p className="font-pixel" style={{
            color: who === 'corujao' ? '#ffd54a' : who === 'consciencia' ? '#7aff9a' : '#88ff66',
            fontSize: 9, marginBottom: 8,
            textShadow: who === 'consciencia' ? '0 0 8px #00ff88' : 'none',
            animation: who === 'consciencia' ? 'breathe-glow 2s ease-in-out infinite' : 'none',
          }}>
            {name}
          </p>
        )}
        <p className="font-vt" style={{
          color: '#eaf6e0', fontSize: 22, lineHeight: 1.35,
          fontStyle: who === 'narrador' ? 'italic' : 'normal',
          minHeight: 30,
        }}>
          {shown}
        </p>
        {done && (
          <p className="font-pixel" style={{ color: '#7fae7a', fontSize: 8, textAlign: 'right', marginTop: 6 }}>
            {last ? '✦' : '▶'} toque
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Beat de pergunta: intro → opções → (acerto: falas) / (erro: Corujão)
// ─────────────────────────────────────────────────────────
function QuestionBeat({ beat, onSolved, onCorrect }: { beat: Extract<Beat, { t: 'question' }>; onSolved: () => void; onCorrect: () => void }) {
  type Phase = 'intro' | 'asking' | 'wrong' | 'success';
  const [phase, setPhase] = useState<Phase>(beat.intro ? 'intro' : 'asking');
  const [successIdx, setSuccessIdx] = useState(0);

  if (phase === 'intro' && beat.intro) {
    return <DialogueBox who="narrador" text={beat.intro} onNext={() => setPhase('asking')} />;
  }

  if (phase === 'wrong') {
    return (
      <DialogueBox who="corujao"
        text={beat.hint ?? 'Pense com calma, jovem. A natureza sempre dá uma pista.'}
        onNext={() => setPhase('asking')} />
    );
  }

  if (phase === 'success') {
    const line = beat.success[successIdx] ?? '';
    const last = successIdx >= beat.success.length - 1;
    return (
      <DialogueBox who="estudante" text={line} last={last}
        onNext={() => { if (last) onSolved(); else setSuccessIdx(i => i + 1); }} />
    );
  }

  // phase === 'asking'
  const answer = (i: number) => {
    if (i === beat.q.correct) { playSfx('correct'); recordSolved(); setSuccessIdx(0); onCorrect(); setPhase('success'); }
    else { playSfx('wrong'); recordError(); setPhase('wrong'); }
  };
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 100, zIndex: 40 }}>
      <div
        style={{ ...WOOD_PANEL, margin: '0 14px 18px', padding: '16px 18px', maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
        <p className="font-vt" style={{ color: '#eaf6e0', fontSize: 21, lineHeight: 1.3, marginBottom: 14 }}>
          {beat.q.text}
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {beat.q.options.map((opt, i) => (
            <button key={i} onPointerDown={(e) => { e.preventDefault(); answer(i); }} onContextMenu={(e) => e.preventDefault()}
              className="font-vt"
              style={{
                textAlign: 'left', padding: '10px 14px', fontSize: 18,
                color: '#eaf6e0', background: 'rgba(30,70,38,0.9)',
                border: '2px solid #2f6b34',  cursor: 'pointer',
                touchAction: 'none',
              } as CSSProperties}>
              {String.fromCharCode(65 + i)}. {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Beat de pareamento: dois grupos de cards para conectar
// ─────────────────────────────────────────────────────────
function MatchBeat({ beat, onSolved, onCorrect }: { beat: Extract<Beat, { t: 'match' }>; onSolved: () => void; onCorrect: () => void }) {
  type Phase = 'intro' | 'matching' | 'wrong' | 'success';
  const [phase, setPhase] = useState<Phase>(beat.intro ? 'intro' : 'matching');
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [successIdx, setSuccessIdx] = useState(0);

  // embaralha a coluna direita uma única vez
  const rightOrder = useMemo(() => {
    const idx = beat.pairs.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'intro' && beat.intro) {
    return <DialogueBox who="narrador" text={beat.intro} onNext={() => setPhase('matching')} />;
  }
  if (phase === 'wrong') {
    return (
      <DialogueBox who="corujao"
        text={beat.hint ?? 'Observe com atenção. Cada parte tem um papel único na planta.'}
        onNext={() => { setSelectedLeft(null); setPhase('matching'); }} />
    );
  }
  if (phase === 'success') {
    const line = beat.success[successIdx] ?? '';
    const last = successIdx >= beat.success.length - 1;
    return (
      <DialogueBox who="estudante" text={line} last={last}
        onNext={() => { if (last) onSolved(); else setSuccessIdx(i => i + 1); }} />
    );
  }

  const pickLeft = (i: number) => {
    if (matched.has(i)) return;
    setSelectedLeft(prev => prev === i ? null : i);
  };

  const pickRight = (rightIdx: number) => {
    const pairIdx = rightOrder[rightIdx];
    if (matched.has(pairIdx) || selectedLeft === null) return;
    if (selectedLeft === pairIdx) {
      const next = new Set(matched); next.add(pairIdx);
      setMatched(next); setSelectedLeft(null);
      if (next.size === beat.pairs.length) { playSfx('correct'); recordSolved(); onCorrect(); setSuccessIdx(0); setPhase('success'); }
    } else {
      playSfx('wrong'); recordError();
      setPhase('wrong');
    }
  };

  const cardStyle = (active: boolean, done: boolean): CSSProperties => ({
    padding: '10px 12px', fontSize: 17, textAlign: 'left', 
    cursor: done ? 'default' : 'pointer', touchAction: 'none',
    color:       done ? '#4aff88' : active ? '#ffe070' : '#eaf6e0',
    background:  done ? 'rgba(20,80,20,0.9)' : active ? 'rgba(80,60,10,0.9)' : 'rgba(30,70,38,0.9)',
    border: `2px solid ${done ? '#4aff88' : active ? '#ffe070' : '#2f6b34'}`,
    transition: 'border-color 0.15s, background 0.15s',
  });

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 100, zIndex: 40 }}>
      <div
        style={{ ...WOOD_PANEL, margin: '0 14px 18px', padding: '16px 18px', maxWidth: 760, marginLeft: 'auto', marginRight: 'auto' }}>
        <p className="font-pixel" style={{ color: '#e8c088', fontSize: 9, marginBottom: 12, letterSpacing: 2 }}>
          CONECTE CADA PARTE À SUA FUNÇÃO
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {/* coluna esquerda — partes da planta */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {beat.pairs.map((pair, i) => (
              <button key={i}
                onPointerDown={(e) => { e.preventDefault(); pickLeft(i); }}
                onContextMenu={(e) => e.preventDefault()}
                className="font-vt"
                style={cardStyle(selectedLeft === i, matched.has(i))}>
                {matched.has(i) ? '✓ ' : selectedLeft === i ? '▶ ' : ''}{pair.left}
              </button>
            ))}
          </div>
          {/* coluna direita — funções embaralhadas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rightOrder.map((pairIdx, i) => (
              <button key={i}
                onPointerDown={(e) => { e.preventDefault(); pickRight(i); }}
                onContextMenu={(e) => e.preventDefault()}
                className="font-vt"
                style={cardStyle(false, matched.has(pairIdx))}>
                {matched.has(pairIdx) ? '✓ ' : ''}{beat.pairs[pairIdx].right}
              </button>
            ))}
          </div>
        </div>
        {selectedLeft !== null && (
          <p className="font-pixel" style={{ color: '#7fae7a', fontSize: 8, marginTop: 10, textAlign: 'center' }}>
            ▶ agora toque na função correspondente →
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Beat de coleta: 5 maçãs saem de trás da árvore e flutuam na tela
// ─────────────────────────────────────────────────────────
function CollectBeat({ beat, onSolved, onCorrect }: { beat: Extract<Beat, { t: 'collect' }>; onSolved: () => void; onCorrect: () => void }) {
  type Phase = 'intro' | 'collecting' | 'wrong' | 'success';
  const [phase, setPhase] = useState<Phase>(beat.intro ? 'intro' : 'collecting');
  const [collected, setCollected] = useState<Set<number>>(new Set());
  const collectedRef = useRef<Set<number>>(new Set());
  const [popped, setPopped] = useState<Set<number>>(new Set());
  const [successIdx, setSuccessIdx] = useState(0);

  const correctCount = beat.items.filter(i => i.correct).length;

  // Cada maçã é uma COLUNA centrada no ponto `left` (ancorada com translateX(-50%)
  // via marginLeft), então o rótulo nunca escapa da tela. `left` fica numa faixa
  // segura (16%–84%) e os cantos superiores ficam abaixo do botão SAIR (topo-dir.).
  // ox/oy = de onde a maçã emerge (atrás da árvore, ~55% left).
  const appleData = useMemo(() => {
    const SLOTS = [
      { left: '18%', top: '32%', ox: '34vw',  oy: '2vh',  floatDur: '3.8s', floatPhase: '-0.5s', delay: '0.05s' },
      { left: '34%', top: '18%', ox: '22vw',  oy: '16vh', floatDur: '4.3s', floatPhase: '-1.8s', delay: '0.22s' },
      { left: '50%', top: '12%', ox: '6vw',   oy: '20vh', floatDur: '3.5s', floatPhase: '-0.9s', delay: '0.38s' },
      { left: '66%', top: '18%', ox: '-10vw', oy: '16vh', floatDur: '4.1s', floatPhase: '-2.4s', delay: '0.14s' },
      { left: '82%', top: '32%', ox: '-24vw', oy: '2vh',  floatDur: '3.9s', floatPhase: '-1.3s', delay: '0.29s' },
    ];
    return beat.items.slice(0, 5).map((item, i) => ({ ...item, id: i, ...SLOTS[i] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const COLW = 104; // largura da coluna maçã+rótulo (centrada no ponto `left`)

  if (phase === 'intro' && beat.intro)
    return <DialogueBox who="narrador" text={beat.intro} onNext={() => setPhase('collecting')} />;
  if (phase === 'wrong')
    return <DialogueBox who="corujao"
      text={beat.hint ?? 'Dispersão é como a semente viaja longe da planta mãe.'}
      onNext={() => setPhase('collecting')} />;
  if (phase === 'success') {
    const line = beat.success[successIdx] ?? '';
    const last = successIdx >= beat.success.length - 1;
    return <DialogueBox who="estudante" text={line} last={last}
      onNext={() => { if (last) onSolved(); else setSuccessIdx(i => i + 1); }} />;
  }

  const tap = (item: typeof appleData[0]) => {
    if (collectedRef.current.has(item.id) || popped.has(item.id)) return;
    if (item.correct) {
      setPopped(p => new Set(p).add(item.id));
      setTimeout(() => {
        // Usa ref para contagem síncrona — React 18 batelha setState mesmo em setTimeout,
        // então o updater só roda no próximo render, nunca sincronamente.
        const next = new Set(collectedRef.current).add(item.id);
        collectedRef.current = next;
        setCollected(new Set(next));
        if (next.size === correctCount) {
          playSfx('correct'); recordSolved();
          onCorrect();
          setSuccessIdx(0);
          setPhase('success');
        }
      }, 400);
    } else {
      playSfx('wrong'); recordError();
      setPhase('wrong');
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }}>
      {/* instrução na base, acima do FLOOR; com progresso em "pips" de maçã */}
      <div className="font-pixel" style={{
        ...WOOD_PANEL,
        position: 'absolute', bottom: 112, left: '50%', transform: 'translateX(-50%)',
        padding: '8px 14px 10px', color: '#eaf6e0',
        fontSize: 9, letterSpacing: 1, textAlign: 'center',
        maxWidth: 'min(320px, calc(100vw - 28px))', zIndex: 35,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
      }}>
        <span style={{ lineHeight: 1.4 }}>{beat.instruction}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: correctCount }).map((_, i) => {
            const filled = i < collected.size;
            return (
              <span key={i} style={{
                width: 12, height: 12, borderRadius: 3,
                border: '1px solid #2f6b34',
                background: filled ? '#e2412f' : 'rgba(0,0,0,0.35)',
                boxShadow: filled ? '0 0 6px rgba(226,65,47,0.7)' : 'none',
                transformOrigin: 'center',
                animation: filled ? 'pip-fill 0.35s ease-out' : undefined,
              }} />
            );
          })}
        </span>
      </div>

      {/* 5 maçãs: cada uma é uma COLUNA centrada em `left` (marginLeft = -COLW/2),
          então o rótulo pode quebrar sem escapar da tela. div externo faz o emerge;
          div interno flutua. */}
      {appleData.map(apple => {
        const done = collected.has(apple.id);
        const popping = popped.has(apple.id) && !done;
        if (done) return null;

        // flutuação começa depois que o emerge termina (0.75s + delay de stagger)
        const floatStart = `calc(0.75s + ${apple.delay} + ${apple.floatPhase})`;

        return (
          <div
            key={apple.id}
            onPointerDown={(e) => { e.preventDefault(); tap(apple); }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              position: 'absolute', left: apple.left, top: apple.top,
              width: COLW, marginLeft: -COLW / 2,
              ['--ox' as string]: apple.ox, ['--oy' as string]: apple.oy,
              animation: popping
                ? 'apple-pop 0.4s ease-out forwards'
                : `apple-emerge 0.75s cubic-bezier(0.1,1.3,0.4,1) ${apple.delay} both`,
              pointerEvents: 'auto', cursor: 'pointer', zIndex: 32, touchAction: 'none',
            }}>
            {/* filho: flutuação independente do emerge */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              animation: popping ? undefined : `apple-float ${apple.floatDur} ease-in-out ${floatStart} infinite`,
            }}>
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                {/* halo pulsante que convida ao toque */}
                <span aria-hidden style={{
                  position: 'absolute', left: '50%', top: '50%', width: 74, height: 74,
                  borderRadius: '50%', pointerEvents: 'none',
                  background: 'radial-gradient(circle, rgba(255,224,120,0.55) 0%, rgba(255,180,60,0.15) 55%, rgba(0,0,0,0) 72%)',
                  animation: popping ? undefined : `apple-glow ${apple.floatDur} ease-in-out infinite`,
                }} />
                <img src="/escape-assets/ato3/apple.png" alt={apple.label}
                  style={{ height: 56, width: 'auto', imageRendering: 'pixelated', position: 'relative',
                    filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))' }} />
              </div>
              <div className="font-pixel" style={{
                background: 'rgba(8,24,12,0.9)', color: '#eaf6e0',
                fontSize: 8, lineHeight: 1.35, padding: '4px 8px', borderRadius: 5,
                border: '1px solid #2f6b34', textAlign: 'center',
                maxWidth: COLW, whiteSpace: 'normal', wordBreak: 'break-word',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}>
                {apple.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ATO 5 — Sequência: ordene as etapas (ciclo de vida) p/ formar a ponte
// ─────────────────────────────────────────────────────────
function SequenceBeat({ beat, onSolved, onCorrect }: { beat: Extract<Beat, { t: 'sequence' }>; onSolved: () => void; onCorrect: () => void }) {
  type Phase = 'intro' | 'playing' | 'wrong' | 'success';
  const [phase, setPhase] = useState<Phase>(beat.intro ? 'intro' : 'playing');
  const [successIdx, setSuccessIdx] = useState(0);
  const [progress, setProgress] = useState(0);     // quantos passos já encaixados na ordem
  const [shake, setShake] = useState<number | null>(null);

  // chips embaralhados (idx = posição correta no ciclo)
  const shuffled = useMemo(() => {
    const arr = beat.steps.map((label, idx) => ({ label, idx }));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [beat.steps]);

  if (phase === 'intro' && beat.intro)
    return <DialogueBox who="narrador" text={beat.intro} onNext={() => setPhase('playing')} />;
  if (phase === 'wrong')
    return <DialogueBox who="corujao" text={beat.hint ?? 'Pense na ordem do ciclo...'} onNext={() => { setProgress(0); setPhase('playing'); }} />;
  if (phase === 'success') {
    const line = beat.success[successIdx] ?? '';
    const last = successIdx >= beat.success.length - 1;
    return <DialogueBox who="estudante" text={line} last={last}
      onNext={() => { if (last) onSolved(); else setSuccessIdx(i => i + 1); }} />;
  }

  const tap = (chip: { label: string; idx: number }) => {
    if (chip.idx < progress) return;          // já encaixado
    if (chip.idx === progress) {
      const np = progress + 1;
      setProgress(np);
      if (np === beat.steps.length) { playSfx('correct'); recordSolved(); onCorrect(); setSuccessIdx(0); setTimeout(() => setPhase('success'), 700); }
    } else {
      playSfx('wrong'); recordError();
      setShake(chip.idx);
      setTimeout(() => { setShake(null); setPhase('wrong'); }, 480);
    }
  };

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 92, zIndex: 40, padding: '0 14px' }}>
      {/* trilha de vitórias-régias (pedras que acendem) */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
        {beat.steps.map((_, i) => (
          <div key={i} style={{
            width: 36, height: 36, borderRadius: '50%',
            background: i < progress ? 'radial-gradient(circle,#9dffb0,#1f9c3a)' : 'rgba(8,26,14,0.75)',
            border: i < progress ? '2px solid #d6ffe0' : '2px solid #2a5a32',
            boxShadow: i < progress ? '0 0 16px rgba(0,255,110,0.8)' : 'none',
            transition: 'all .3s', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>{i < progress ? <PixelIcon kind="lily" size={22} /> : '·'}</div>
        ))}
      </div>
      <div style={{ ...WOOD_PANEL, padding: '12px 14px', maxWidth: 560, margin: '0 auto' }}>
        <p className="font-pixel" style={{ color: '#e8c088', fontSize: 9, marginBottom: 12, textAlign: 'center', lineHeight: 1.5 }}>{beat.instruction}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {shuffled.map(chip => {
            const placed = chip.idx < progress;
            return (
              <button key={chip.idx} onPointerDown={(e) => { e.preventDefault(); tap(chip); }} disabled={placed}
                className="font-vt"
                style={{
                  fontSize: 18, padding: '10px 14px',  cursor: placed ? 'default' : 'pointer',
                  color: placed ? '#5a8a5a' : '#eaf6e0',
                  background: placed ? 'rgba(20,50,26,0.6)' : 'rgba(30,70,38,0.95)',
                  border: shake === chip.idx ? '2px solid #ff5a5a' : '2px solid #3a8a42',
                  opacity: placed ? 0.35 : 1,
                  animation: shake === chip.idx ? 'boulder-shake 0.13s ease-in-out infinite' : undefined,
                  touchAction: 'none',
                } as CSSProperties}>
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ATO 7 — A Escolha: decisão final com dois desfechos cinematográficos
// ─────────────────────────────────────────────────────────
function ChoiceBeat({ beat, onSolved }: { beat: Extract<Beat, { t: 'choice' }>; onSolved: () => void }) {
  type Phase = 'intro' | 'deciding' | 'ending';
  const [phase, setPhase] = useState<Phase>(beat.intro ? 'intro' : 'deciding');
  const [chosen, setChosen] = useState<Extract<Beat, { t: 'choice' }>['options'][number] | null>(null);
  const [endIdx, setEndIdx] = useState(0);

  // Cartão de ilustração emoldurado — igual aos outros cartões de lore.
  // A base (ajoelhado diante da árvore) estabelece o tamanho; as artes de
  // desfecho ficam sobrepostas no mesmo enquadramento (opacity 0) e entram
  // por crossfade suave ao escolher. Todas no MESMO tamanho.
  const artCard = (maxH: string) => (
    <div style={{
      position: 'relative', maxWidth: '86%',
      filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.95))',
      imageRendering: 'pixelated',
    }}>
      {/* base — define a caixa */}
      <img src={beat.img} alt="" style={{
        display: 'block', maxWidth: '100%', maxHeight: maxH,
        imageRendering: 'pixelated',
      }} />
      {/* desfechos sobrepostos, mesmo enquadramento */}
      {beat.options.map(opt => opt.img && (
        <img key={opt.label} src={opt.img} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', imageRendering: 'pixelated',
          opacity: chosen === opt ? 1 : 0, transition: 'opacity 2s ease',
        }} />
      ))}
    </div>
  );

  // fundo escuro atrás do cartão (mesmo clima dos outros cartões de lore)
  const darkBg = (
    <div style={{ position: 'absolute', inset: 0, zIndex: 38, background: 'rgba(0,0,0,0.92)', pointerEvents: 'none' }} />
  );

  if (phase === 'intro' && beat.intro) {
    return (
      <>
        {darkBg}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 220, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {artCard('52vh')}
        </div>
        <DialogueBox who="narrador" text={beat.intro} onNext={() => { audioCtx(); setPhase('deciding'); }} />
      </>
    );
  }

  if (phase === 'deciding') {
    return (
      <>
        {darkBg}
        <div style={{ position: 'absolute', inset: 0, zIndex: 42, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '16px 20px' }}>
          {artCard('40vh')}
          <p className="font-vt" style={{ color: '#fff', fontSize: 23, textAlign: 'center', textShadow: '0 2px 12px #000', padding: '0 8px', lineHeight: 1.3 }}>{beat.prompt}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 340 }}>
            {beat.options.map(opt => (
              <button key={opt.label} onPointerDown={(e) => { e.preventDefault(); audioCtx(); recordEnding(opt.tone); setChosen(opt); setEndIdx(0); setPhase('ending'); if (opt.tone === 'sombra') playTone(110, 0.8, 'sawtooth', 0.1); else playChord([PENTA[0], PENTA[2], PENTA[4]], 2.0, 0.09); }}
                className="font-pixel"
                style={{
                  fontSize: 12, padding: '16px 12px',  cursor: 'pointer', lineHeight: 1.4,
                  color: opt.tone === 'luz' ? '#0a2010' : '#f0dee6',
                  background: opt.tone === 'luz' ? 'linear-gradient(to bottom,#7be04a,#2f9410)' : 'linear-gradient(to bottom,#5a3a4a,#2a1820)',
                  border: opt.tone === 'luz' ? '3px solid #d6ffe0' : '3px solid #6a4a5a',
                  boxShadow: opt.tone === 'luz' ? '0 0 22px rgba(0,255,100,0.5)' : '0 4px 0 #1a0e14',
                  touchAction: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                } as CSSProperties}>
                <PixelIcon kind={opt.tone === 'luz' ? 'sprout' : 'wilt'} size={20} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  // ending — a arte do desfecho já entrou por crossfade dentro do cartão
  const line = chosen!.ending[endIdx] ?? '';
  const last = endIdx >= chosen!.ending.length - 1;
  return (
    <>
      {darkBg}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 220, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {artCard('52vh')}
      </div>
      <DialogueBox who="narrador" text={line} last={last}
        onNext={() => { if (last) onSolved(); else setEndIdx(i => i + 1); }} />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Partículas atmosféricas por cena
//  • pantano/final: motes flutuantes (esporos/pólen dourado)
//  • folhas: folhas pixel caindo devagar (florestas)
// ─────────────────────────────────────────────────────────
const LEAF_COLORS = ['#4fae35', '#6fd04a', '#8fbc3a', '#c4a03a', '#3a8a4a'];

function SceneParticles({ kind }: { kind: 'pantano' | 'final' | 'folhas' }) {
  const s = (n: number) => { const x = Math.sin(n + 1) * 10000; return x - Math.floor(x); };

  if (kind === 'folhas') {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 9 }, (_, i) => {
          const size = 3 + Math.round(s(i * 3) * 3);          // 3–6 px, quadrado (pixel)
          const dur = 9 + s(i * 11) * 8;                      // 9–17s de queda
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${s(i * 7) * 100}%`, top: 0,
              width: size, height: size,
              background: LEAF_COLORS[i % LEAF_COLORS.length],
              animation: `leaf-fall ${dur}s linear ${-s(i * 17) * dur}s infinite`,
              ['--lx' as string]: `${(s(i * 13) > 0.5 ? 1 : -1) * (30 + s(i * 19) * 90)}px`,
              ['--lr' as string]: `${180 + Math.round(s(i * 23) * 400)}deg`,
            } as CSSProperties} />
          );
        })}
      </div>
    );
  }

  const cfg = kind === 'pantano'
    ? { count: 11, grad: 'radial-gradient(circle,#d4ffb0,#7ac850)', glow: 'rgba(150,255,120,0.6)' }
    : { count: 22, grad: 'radial-gradient(circle,#fff6d0,#ffcf57)', glow: 'rgba(255,200,80,0.7)' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', overflow: 'hidden' }}>
      {kind === 'pantano' && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%',
          background: 'linear-gradient(to top, rgba(110,170,120,0.4), transparent)',
          animation: 'light-pulse-dark 5s ease-in-out infinite' }} />
      )}
      {Array.from({ length: cfg.count }, (_, i) => {
        const size = 2 + s(i * 3) * 4;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${s(i * 7) * 100}%`,
            [kind === 'pantano' ? 'bottom' : 'top']: `${s(i * 23) * (kind === 'pantano' ? 42 : 90)}%`,
            width: size, height: size, borderRadius: '50%',
            background: cfg.grad, boxShadow: `0 0 8px ${cfg.glow}`,
            animation: `mote-float ${7 + s(i * 11) * 7}s ease-in-out ${-s(i * 17) * 9}s infinite`,
            ['--mx' as string]: `${(s(i * 13) > 0.5 ? 1 : -1) * (15 + s(i * 19) * 40)}px`,
          } as CSSProperties} />
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Mundo com parallax
// ─────────────────────────────────────────────────────────
// Cenário espalhado pelo mundo: árvores ao fundo (atrás do herói) e
// arbustos/pedras em primeiro plano (na frente). `f` = fator de parallax.
interface Prop { src: string; wx: number; f: number; h: number; b: number; z: number; flip?: boolean; sway?: boolean; glow?: boolean }

// Flora mágica espalhada pelo mundo. `glow` adiciona um halo turquesa.
// Plantas/cogumelos da floresta encantada — algumas atrás do herói (z<14),
// outras em primeiro plano (14<z<20, na frente do herói mas atrás da grama z=20).
// Toda a flora assenta na mesma linha de chão do personagem (b ≈ GROUND - 4).
// A profundidade vem do tamanho + parallax + z (atrás/à frente do herói).
const FLORA_B = GROUND - 4;
const FLORA_B_BACK = FLORA_B + 10;  // plantas das camadas de trás ficam 10px mais altas
const SCENERY: Prop[] = [
  // ── fundo profundo (entre as camadas da floresta) ──
  { src: 'flora/glow-grass.png',    wx: 260,  f: 0.5,  h: 12, b: FLORA_B_BACK, z: 4, glow: true },
  { src: 'flora/flower-blue.png',   wx: 560,  f: 0.55, h: 14, b: FLORA_B_BACK, z: 4, glow: true },
  { src: 'flora/shroom-big.png',    wx: 900,  f: 0.6,  h: 13, b: FLORA_B_BACK, z: 5, glow: true, flip: true },
  { src: 'flora/flower-purple.png', wx: 1240, f: 0.52, h: 14, b: FLORA_B_BACK, z: 4, glow: true },
  { src: 'flora/shroom-small.png',  wx: 1560, f: 0.58, h: 10, b: FLORA_B_BACK, z: 5, glow: true },
  { src: 'flora/glow-grass.png',    wx: 1900, f: 0.5,  h: 12, b: FLORA_B_BACK, z: 4, glow: true, flip: true },

  // ── atrás do herói (mais ao fundo) ──
  { src: 'flora/glow-grass.png',    wx: 180,  f: 0.92, h: 20, b: FLORA_B_BACK, z: 8,  glow: true },
  { src: 'flora/flower-blue.png',   wx: 430,  f: 0.95, h: 28, b: FLORA_B_BACK, z: 8,  glow: true },
  { src: 'flora/shroom-big.png',    wx: 700,  f: 0.96, h: 22, b: FLORA_B_BACK, z: 9,  glow: true, flip: true },
  { src: 'flora/flower-purple.png', wx: 1020, f: 0.94, h: 26, b: FLORA_B_BACK, z: 8,  glow: true },
  { src: 'flora/glow-grass.png',    wx: 1320, f: 0.93, h: 18, b: FLORA_B_BACK, z: 9,  glow: true },
  { src: 'flora/shroom-small.png',  wx: 1600, f: 0.95, h: 14, b: FLORA_B_BACK, z: 9,  glow: true },
  { src: 'flora/flower-tulip.png',  wx: 1880, f: 0.95, h: 23, b: FLORA_B_BACK, z: 8,  glow: true },

  // ── na frente do herói (primeiro plano) ──
  { src: 'flora/shroom-big.png',    wx: 320,  f: 1.04, h: 38, b: FLORA_B, z: 16, glow: true },
  { src: 'flora/glow-grass.png',    wx: 600,  f: 1.06, h: 32, b: FLORA_B, z: 17, glow: true, flip: true },
  { src: 'flora/flower-purple.png', wx: 880,  f: 1.05, h: 42, b: FLORA_B, z: 16, glow: true },
  { src: 'flora/shroom-small.png',  wx: 1180, f: 1.05, h: 21, b: FLORA_B, z: 17, glow: true, flip: true },
  { src: 'flora/flower-blue.png',   wx: 1480, f: 1.06, h: 40, b: FLORA_B, z: 16, glow: true },
  { src: 'flora/flower-tulip.png',  wx: 1760, f: 1.05, h: 34, b: FLORA_B, z: 17, glow: true },
  { src: 'flora/glow-grass.png',    wx: 2060, f: 1.06, h: 31, b: FLORA_B, z: 16, glow: true },
];

// Camadas do pack "Free Pixel Art Forest" (Eder Muniz), de trás → frente.
// A última camada (Layer_0000_9 = grama/mato) vai NA FRENTE do herói.
const FOREST_LAYERS: { src: string; f: number }[] = [
  { src: 'Layer_0011_0.png',      f: 0.04 },  // céu (fundo)
  { src: 'Layer_0010_1.png',      f: 0.09 },
  { src: 'Layer_0009_2.png',      f: 0.15 },
  { src: 'Layer_0008_3.png',      f: 0.22 },
  { src: 'Layer_0007_Lights.png', f: 0.28 },  // raios de luz
  { src: 'Layer_0006_4.png',      f: 0.36 },
  { src: 'Layer_0005_5.png',      f: 0.46 },
  { src: 'Layer_0004_Lights.png', f: 0.54 },  // raios de luz
  { src: 'Layer_0003_6.png',      f: 0.64 },
  { src: 'Layer_0002_7.png',      f: 0.76 },
  { src: 'Layer_0001_8.png',      f: 0.90 },
];

// Variante da clareira (Ato 2): mesmas camadas com Layer_0003_6 e Layer_0002_7 trocados
const CLAREIRA_LAYERS = FOREST_LAYERS.map(l => {
  if (l.src === 'Layer_0003_6.png') return { ...l, src: 'Layer_0003_6_c.png' };
  if (l.src === 'Layer_0002_7.png') return { ...l, src: 'Layer_0002_7_c.png' };
  return l;
});
const FOREST_FOREGROUND = { src: 'Layer_0000_9.png', f: 1.06 }; // grama na frente do herói

function PropImg({ p, worldX }: { p: Prop; worldX: number }) {
  const screenX = Math.round(p.wx - worldX * p.f);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 900;
  // não renderiza se estiver completamente fora do viewport
  if (screenX > vw + p.h || screenX < -(p.h * 2)) return null;
  const glow = p.glow
    ? 'drop-shadow(0 0 4px rgba(64,224,208,0.85)) drop-shadow(0 0 10px rgba(64,224,208,0.55)) drop-shadow(0 0 18px rgba(48,200,210,0.35)) '
    : '';
  // balanço suave com duração/atraso variados por posição (sem sincronizar)
  const dur = 3.4 + (p.wx % 5) * 0.45;
  const delay = (p.wx % 7) * 0.4;
  return (
    <div style={{ position: 'absolute', left: screenX, bottom: p.b, zIndex: p.z, transform: p.flip ? 'scaleX(-1)' : undefined, transformOrigin: 'bottom center' }}>
      <img src={`/escape-assets/${p.src}`} alt=""
        style={{
          height: p.h, width: 'auto', display: 'block', imageRendering: 'pixelated',
          filter: `${glow}drop-shadow(0 6px 6px rgba(0,0,0,0.32))`,
          transformOrigin: 'bottom center',
          animation: `flora-sway ${dur.toFixed(2)}s ease-in-out ${delay.toFixed(2)}s infinite`,
        }} />
    </div>
  );
}

function CorredorButterflies() {
  // rev: true = voa da direita pra esquerda (com scaleX(-1))
  const front = [
    { color: 'orange', delay: 0,  dur: 18, bobDur: 1.4, bobAnim: 'butterfly-bob-a', y: 38, size: 22, rev: false },
    { color: 'blue',   delay: 7,  dur: 23, bobDur: 1.8, bobAnim: 'butterfly-bob-b', y: 50, size: 20, rev: true  },
    { color: 'orange', delay: 13, dur: 20, bobDur: 1.2, bobAnim: 'butterfly-bob-c', y: 28, size: 24, rev: false },
    { color: 'blue',   delay: 21, dur: 26, bobDur: 1.6, bobAnim: 'butterfly-bob-d', y: 44, size: 18, rev: true  },
    { color: 'orange', delay: 9,  dur: 22, bobDur: 1.5, bobAnim: 'butterfly-bob-c', y: 34, size: 19, rev: false },
    { color: 'blue',   delay: 30, dur: 21, bobDur: 1.3, bobAnim: 'butterfly-bob-a', y: 22, size: 21, rev: true  },
  ];
  const back = [
    { color: 'blue',   delay: 4,  dur: 28, bobDur: 2.0, bobAnim: 'butterfly-bob-b', y: 32, size: 15, rev: false },
    { color: 'orange', delay: 16, dur: 32, bobDur: 1.7, bobAnim: 'butterfly-bob-a', y: 42, size: 14, rev: true  },
    { color: 'blue',   delay: 25, dur: 30, bobDur: 2.2, bobAnim: 'butterfly-bob-d', y: 24, size: 16, rev: false },
    { color: 'orange', delay: 11, dur: 35, bobDur: 1.9, bobAnim: 'butterfly-bob-c', y: 36, size: 15, rev: true  },
    { color: 'blue',   delay: 20, dur: 29, bobDur: 2.1, bobAnim: 'butterfly-bob-b', y: 18, size: 14, rev: false },
  ];

  const renderGroup = (list: typeof front, zIndex: number, opacity: number) => (
    <div style={{ position: 'absolute', inset: 0, zIndex, pointerEvents: 'none', overflow: 'hidden' }}>
      {list.map((b, i) => {
        const prefix = b.color === 'orange' ? '' : 'blue-';
        const anim = b.rev ? 'butterfly-move-x-rev' : 'butterfly-move-x';
        return (
          <div key={i} style={{
            position: 'absolute', left: '-40px', top: `${b.y}%`,
            width: b.size, height: b.size, opacity,
            animation: `${anim} ${b.dur}s linear ${-b.delay}s infinite`,
            transform: b.rev ? 'scaleX(-1)' : undefined,
          }}>
            <div style={{ position: 'absolute', inset: 0, animation: `${b.bobAnim} ${b.bobDur}s ease-in-out infinite` }}>
              <img src={`/escape-assets/corredor/butterfly-${prefix}1.png`} alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                  animation: `butterfly-frame 0.22s steps(1) infinite` }} />
              <img src={`/escape-assets/corredor/butterfly-${prefix}2.png`} alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                  animation: `butterfly-frame2 0.22s steps(1) infinite` }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {renderGroup(back, 6, 0.55)}
      {renderGroup(front, 15, 1)}
    </>
  );
}

function LightMotes({ kind = 'default' }: { kind?: 'default' | 'sunset' }) {
  const color = kind === 'sunset'
    ? { bg: 'radial-gradient(circle, #ffe59a, rgba(255,180,40,0.25))', shadow: '0 0 6px 2px rgba(255,180,40,0.7)' }
    : { bg: 'radial-gradient(circle, #b6fff4, rgba(64,224,208,0.25))',  shadow: '0 0 6px 2px rgba(64,224,208,0.6)' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: 16 }, (_, i) => {
        const s = (n: number) => { const x = Math.sin((i + 1) * n) * 10000; return x - Math.floor(x); };
        const size = 2 + s(3) * 3;
        return (
          <div key={i} style={{
            position: 'absolute', left: `${s(7) * 100}%`, bottom: `${s(13) * 60}%`,
            width: size, height: size, borderRadius: 9,
            background: color.bg,
            boxShadow: color.shadow,
            ['--mx' as string]: `${(s(19) > 0.5 ? 1 : -1) * (10 + s(23) * 40)}px`,
            animation: `mote-float ${6 + s(5) * 7}s ease-in-out ${-s(11) * 8}s infinite`,
          }} />
        );
      })}
    </div>
  );
}

type BoulderState = 'idle' | 'shaking' | 'sinking' | 'gone';

function TrunkParticles({ trunkX }: { trunkX: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trunkXRef = useRef(trunkX);
  trunkXRef.current = trunkX;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const s = (n: number) => { const x = Math.sin(n + 1) * 10000; return x - Math.floor(x); };
    const particles = Array.from({ length: 60 }, (_, i) => ({
      spreadX: (s(i * 7) - 0.5) * 70,
      size: 2.5 + s(i * 3) * 4,
      speed: 30 + s(i * 11) * 60,
      driftX: (s(i * 13) > 0.5 ? 1 : -1) * (20 + s(i * 19) * 80),
      life: s(i * 17),   // 0–1, offset de fase
      maxLife: 4 + s(i * 23) * 6,
    }));

    let raf: number;
    let last = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const W = canvas.width; const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2 + trunkXRef.current;

      for (const p of particles) {
        p.life += dt / p.maxLife;
        if (p.life > 1) p.life -= 1;
        const t = p.life;
        const alpha = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
        const x = cx + p.spreadX + p.driftX * t;
        const y = H - 80 - p.speed * p.maxLife * t;
        if (y < 0 || y > H) continue;
        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.shadowColor = '#40e0d0';
        ctx.shadowBlur = p.size * 3;
        ctx.fillStyle = '#40e0d0';
        ctx.beginPath();
        ctx.arc(x, y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15 }} />;
}

function EstufaAmbientParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    const s = (n: number) => { const x = Math.sin(n + 7) * 10000; return x - Math.floor(x); };
    const particles = Array.from({ length: 50 }, (_, i) => ({
      x: s(i * 11),   // 0–1 normalizado
      y: s(i * 17),
      size: 2 + s(i * 5) * 3,
      speed: 8 + s(i * 13) * 18,
      driftX: (s(i * 23) - 0.5) * 40,
      life: s(i * 19),
      maxLife: 6 + s(i * 29) * 10,
    }));

    let raf: number;
    let last = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const W = canvas.width; const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        p.life += dt / p.maxLife;
        if (p.life > 1) p.life -= 1;
        const t = p.life;
        const alpha = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 0.7;
        const x = p.x * W + p.driftX * t;
        const y = p.y * H - p.speed * p.maxLife * t;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#40e0d0';
        ctx.shadowBlur = p.size * 2;
        ctx.fillStyle = '#b0fff8';
        ctx.beginPath();
        ctx.arc(x, ((y % H) + H) % H, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 16 }} />;
}

function TrunkSprite({ height }: { height: number }) {
  const [frame, setFrame] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => f === 3 ? 1 : f + 1), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <img src={`/escape-assets/estufa/trunk-${frame}.png`} alt="tronco pulsante"
      style={{ display: 'block', height, width: 'auto', imageRendering: 'pixelated',
        filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.7))' }} />
  );
}

function GuardianSprite() {
  const [frame, setFrame] = useState(1);
  useEffect(() => {
    const t1 = setTimeout(() => setFrame(2), 5000);
    const t2 = setTimeout(() => setFrame(3), 5800);
    const t3 = setTimeout(() => setFrame(4), 6600);
    const t4 = setTimeout(() => setFrame(5), 7400);
    let iv: ReturnType<typeof setInterval>;
    const t5 = setTimeout(() => {
      iv = setInterval(() => setFrame(f => f === 5 ? 4 : 5), 800);
    }, 8200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); clearInterval(iv); };
  }, []);
  return (
    <img
      src={`/escape-assets/world/guardian-${frame}.png`}
      alt="guardião"
      style={{ display: 'block', height: 200, width: 'auto', imageRendering: 'pixelated',
        filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.75))' }}
    />
  );
}

// ─────────────────────────────────────────────────────────
// Lore: ilustração cinemática em tela cheia
// ─────────────────────────────────────────────────────────
function LoreBeat({ beat, onSolved }: { beat: Extract<Beat, { t: 'lore' }>; onSolved: () => void }) {
  const [vis, setVis] = useState(false);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVis(true), 40);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    if (out) return;
    setOut(true);
    setTimeout(onSolved, 400);
  };

  const full = !!beat.full;

  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); dismiss(); }}
      style={{
        position: 'absolute', inset: 0, zIndex: 60,
        // no modo full o fundo é preto sólido (esconde o cenário por completo);
        // no cartão normal fica quase preto, deixando o cenário levemente à mostra
        background: `rgba(0,0,0,${vis && !out ? (full ? 1 : 0.92) : 0})`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.45s',
        cursor: 'pointer', touchAction: 'none',
      }}
    >
      {full ? (
        // ── TELA CHEIA — a imagem cobre tudo (cover), sem moldura ──
        <div style={{
          position: 'absolute', inset: 0, overflow: 'hidden',
          opacity: vis && !out ? 1 : 0, transition: 'opacity 0.45s',
        }}>
          <img
            src={beat.img}
            alt=""
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center',
              imageRendering: 'pixelated', display: 'block',
              animation: 'lore-kenburns 14s ease-out forwards',
            }}
          />
          {beat.fx && <LoreFx kind={beat.fx} />}
        </div>
      ) : (
        // ── CARTÃO — imagem centralizada com moldura ──
        <div style={{
          maxWidth: '92%', overflow: 'hidden',
          opacity: vis && !out ? 1 : 0,
          transition: 'opacity 0.45s',
          filter: 'drop-shadow(0 12px 40px rgba(0,0,0,0.95))',
        }}>
          <div style={{ position: 'relative' }}>
            <img
              src={beat.img}
              alt=""
              style={{
                maxWidth: '100%', maxHeight: '60vh',
                imageRendering: 'pixelated',
                display: 'block',
                animation: 'lore-kenburns 14s ease-out forwards',
              }}
            />
            {beat.fx && <LoreFx kind={beat.fx} />}
          </div>
        </div>
      )}

      {beat.caption && (
        <div
          className="font-pixel"
          style={{
            // no modo full a legenda flutua perto do rodapé, sobre a imagem
            ...(full
              ? { position: 'absolute' as const, bottom: 70, left: '8%', right: '8%', maxWidth: 'none' }
              : { marginTop: 16, maxWidth: '84%' }),
            padding: '12px 18px',
            background: '#1a0e06',
            border: '4px solid #8b5e2e',
            boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
            color: '#ffe8c0',
            fontSize: 11,
            textAlign: 'center',
            lineHeight: 1.6,
            opacity: vis && !out ? 1 : 0,
            transition: 'opacity 0.45s 0.12s',
          }}
        >
          {beat.caption}
        </div>
      )}
      <div
        className="font-pixel"
        style={{
          position: 'absolute', bottom: 28,
          color: 'rgba(255,255,255,0.55)',
          fontSize: 9,
          textShadow: full ? '0 2px 6px rgba(0,0,0,0.9)' : 'none',
          opacity: vis && !out ? 1 : 0,
          transition: 'opacity 0.6s 0.3s',
          animation: vis && !out ? 'hint-bob 1.4s ease-in-out infinite' : undefined,
        }}
      >
        toque para continuar
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// EPÍLOGO — sequência final ilustrada em tela cheia.
// As imagens fazem crossfade DIRETO de uma para a outra (sem passar pelo
// preto), como a intro. Cada passo mostra um texto; passos sem `img`
// mantêm a imagem anterior (fala sobre a mesma cena).
// ─────────────────────────────────────────────────────────
function EpilogueBeat({ beat, onSolved }: { beat: Extract<Beat, { t: 'outro' }>; onSolved: () => void }) {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  const [out, setOut] = useState(false);
  const [vis, setVis] = useState(false);

  useEffect(() => { const t = setTimeout(() => setVis(true), 40); return () => clearTimeout(t); }, []);

  const step = beat.steps[idx];
  const text = step.text;

  // camadas de imagem únicas, empilhadas — só a ativa fica em opacity 1
  const images = useMemo(
    () => [...new Set(beat.steps.map(s => s.img).filter((s): s is string => !!s))],
    [beat.steps],
  );
  // imagem ativa = último passo (até idx) que define uma img
  const activeImg = useMemo(() => {
    for (let i = idx; i >= 0; i--) { const im = beat.steps[i].img; if (im) return im; }
    return undefined;
  }, [idx, beat.steps]);

  // máquina de escrever
  useEffect(() => {
    setShown(''); setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++; setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, 30);
    return () => clearInterval(id);
  }, [idx, text]);

  const tap = () => {
    if (out) return;
    if (!done) { setShown(text); setDone(true); return; }
    playSfx('tap');
    if (idx >= beat.steps.length - 1) { setOut(true); setTimeout(onSolved, 550); return; }
    setIdx(i => i + 1);
  };

  const isDialogue = !!step.who && step.who !== 'narrador';
  const name = step.who ? SPEAKER_NAME[step.who] : '';
  const portrait = step.who === 'corujao' ? '/escape-assets/portraits/owl.png'
    : step.who === 'estudante' ? '/escape-assets/portraits/hero.png'
    : step.who === 'consciencia' ? '/escape-assets/portraits/consciencia.png' : null;

  return (
    <div
      onPointerDown={(e) => { e.preventDefault(); tap(); }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute', inset: 0, zIndex: 60, background: '#000',
        opacity: out ? 0 : 1, transition: 'opacity 0.5s',
        cursor: 'pointer', touchAction: 'none', overflow: 'hidden',
      }}
    >
      {/* camadas de imagem — crossfade direto entre elas */}
      {images.map(src => (
        <img key={src} src={src} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center', imageRendering: 'pixelated',
          opacity: (vis && activeImg === src) ? 1 : 0,
          transition: 'opacity 0.9s ease',
        }} />
      ))}

      {/* gradiente inferior p/ legibilidade do texto */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: '48%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 55%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* caixa de texto (moldura de madeira) — narração ou fala com retrato */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, padding: '0 16px', opacity: vis && !out ? 1 : 0, transition: 'opacity 0.4s' }}>
        <div style={{
          margin: '0 auto', maxWidth: 760, padding: '14px 18px',
          background: '#1a0e06', border: '4px solid #8b5e2e',
          boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
          position: 'relative',
        }}>
          {portrait && isDialogue && (
            <div style={{ position: 'absolute', top: -60, left: 8, width: 68, height: 68, background: '#1a0e06', border: '3px solid #8b5e2e', boxShadow: 'inset 0 0 0 1px #c4874c, 0 0 0 1px #3a1f08', imageRendering: 'pixelated' }}>
              <img src={portrait} alt="" style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }} />
            </div>
          )}
          {isDialogue && name && (
            <p className="font-pixel" style={{ color: '#88ff66', fontSize: 9, marginBottom: 8 }}>{name}</p>
          )}
          <p className="font-vt" style={{ color: '#eaf6e0', fontSize: 22, lineHeight: 1.35, fontStyle: isDialogue ? 'normal' : 'italic', minHeight: 30 }}>
            {shown}
          </p>
          {done && (
            <p className="font-pixel" style={{ color: '#7fae7a', fontSize: 8, textAlign: 'right', marginTop: 6 }}>
              {idx >= beat.steps.length - 1 ? '✦' : '▶'} toque
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ATO 6 — Combate: Consciência Verde (estilo Pokémon GBA)
// ─────────────────────────────────────────────────────────
function BattleBeat({ beat, onSolved, onCorrect }: { beat: Extract<Beat, { t: 'battle' }>; onSolved: () => void; onCorrect: () => void }) {
  const PLAYER_MAX = 30;
  const ENEMY_MAX = 40;
  const HIT       = 10;  // dano do jogador ao ACERTAR a pergunta
  const WRONG_HIT = 9;   // dano que o jogador LEVA ao ERRAR (forte)
  const ENEMY_HIT = 4;   // ataque do inimigo no turno dele (fraco)

  // banco de perguntas do combate: usa o do professor (beat.pool) se houver;
  // senão, o banco padrão de botânica
  const POOL = useMemo(() => beat.pool && beat.pool.length > 0 ? beat.pool : [
    { text: 'Qual parte da planta absorve água e nutrientes do solo?',     options: ['A raiz', 'A flor', 'O fruto', 'A folha'], correct: 0 },
    { text: 'Que processo produz energia a partir da luz do sol?',         options: ['Fotossíntese', 'Digestão', 'Respiração', 'Germinação'], correct: 0 },
    { text: 'O que sai pelas folhas durante a transpiração?',              options: ['Vapor de água', 'Sementes', 'Areia', 'Pólen'], correct: 0 },
    { text: 'Como as plantas trocam nutrientes e avisos sob a terra?',     options: ['Rede de fungos', 'Pelo vento', 'Pelas flores', 'Pelos frutos'], correct: 0 },
    { text: 'O que vem primeiro no ciclo de vida de uma planta?',          options: ['A semente', 'A flor', 'O fruto', 'A folha'], correct: 0 },
    { text: 'Qual estrutura da planta atrai os polinizadores?',           options: ['A flor', 'A raiz', 'O caule', 'A casca'], correct: 0 },
    { text: 'O que transporta a seiva por toda a planta?',                 options: ['O caule', 'A flor', 'O fruto', 'A raiz'], correct: 0 },
    { text: 'Como as sementes se espalham para longe da planta-mãe?',      options: ['Vento e animais', 'Por fotossíntese', 'Pela transpiração', 'Por absorção'], correct: 0 },
  ], [beat.pool]);

  type Q = { text: string; options: string[]; correctIdx: number };
  const lastQ = useRef(-1);
  const pickQuestion = useCallback((): Q => {
    let i = Math.floor(Math.random() * POOL.length);
    while (POOL.length > 1 && i === lastQ.current) i = Math.floor(Math.random() * POOL.length);
    lastQ.current = i;
    const base = POOL[i];
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    return { text: base.text, options: order.map(o => base.options[o]), correctIdx: order.indexOf(base.correct) };
  }, [POOL]);

  type Phase = 'intro' | 'question' | 'anim' | 'victory' | 'defeat' | 'success';
  const [phase, setPhase]         = useState<Phase>(beat.intro ? 'intro' : 'question');
  const [q, setQ]                 = useState<Q>(pickQuestion);
  const [playerHp, setPlayerHp]   = useState(PLAYER_MAX);
  const [enemyHp, setEnemyHp]     = useState(ENEMY_MAX);
  const [log, setLog]             = useState(beat.intro ?? '');
  const [shakeEnemy, setShakeEnemy]   = useState(false);
  const [shakePlayer, setShakePlayer] = useState(false);
  const [flashEnemy, setFlashEnemy]   = useState(false);
  const [flashPlayer, setFlashPlayer] = useState(false);
  const [successIdx, setSuccessIdx]   = useState(0);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [wasCorrect, setWasCorrect]   = useState<boolean | null>(null);
  const [idleFrame, setIdleFrame]     = useState(1);
  const [rageFrame, setRageFrame]     = useState(1);
  const [enemyRage, setEnemyRage]     = useState(false);
  const rageAnnounced = useRef(false);
  type EnemyAction = 'idle' | 'hit' | 'attack' | 'defeat' | 'victory';
  const [enemyAction, setEnemyAction] = useState<EnemyAction>('idle');
  type PlayerAction = 'idle' | 'hit' | 'attack' | 'defeat' | 'victory';
  const [playerAction, setPlayerAction] = useState<PlayerAction>('idle');
  useEffect(() => {
    const t = setInterval(() => setIdleFrame(f => f === 1 ? 2 : 1), 700);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!enemyRage) return;
    const t = setInterval(() => setRageFrame(f => f >= 3 ? 1 : f + 1), 180);
    return () => clearInterval(t);
  }, [enemyRage]);
  // Tema de batalha: entra ao montar o combate, sai (e a exploração volta) ao desmontar
  useEffect(() => {
    startBattleMusic();
    return () => stopBattleMusic();
  }, []);

  // Projétil de energia + anel de impacto
  const enemyAnchor  = { x: 64, y: 36 };
  const playerAnchor = { x: 21, y: 66 };

  type Proj = { x: number; y: number; color: string; glow: string; moving: boolean; behind: boolean };
  const [proj, setProj] = useState<Proj | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; color: string; key: number } | null>(null);
  const ringKey = useRef(0);

  // Números de dano flutuantes
  type DmgNum = { x: number; y: number; value: number; color: string; key: number };
  const [dmgNums, setDmgNums] = useState<DmgNum[]>([]);
  const dmgKey = useRef(0);
  function popDamage(x: number, y: number, value: number, color: string) {
    const key = dmgKey.current++;
    setDmgNums(prev => [...prev, { x, y, value, color, key }]);
    setTimeout(() => setDmgNums(prev => prev.filter(d => d.key !== key)), 900);
  }

  // Frases de flavour para os ataques (reforçam o conteúdo botânico)
  const PLAYER_FLAVOR = useMemo(() => [
    'FOTOSSÍNTESE! A luz do sol vira energia pura, super eficaz!',
    'REDE DE FUNGOS! As raízes atacam por baixo da terra!',
    'TRANSPIRAÇÃO! Um jato de vapor atinge em cheio!',
    'ESPORA! Uma nuvem de esporos envolve o alvo!',
  ], []);
  const ENEMY_FLAVOR = useMemo(() => [
    'Raízes Enredantes prendem você!',
    'Pulso de Luz cega seus sentidos!',
    'Névoa Tóxica embaça o ar ao seu redor!',
  ], []);
  const flavorIdx = useRef(0);
  const pickFlavor = (pool: string[]) => pool[(flavorIdx.current++) % pool.length];

  function launch(dir: 'toEnemy' | 'toPlayer', onArrive: () => void) {
    const from  = dir === 'toEnemy' ? playerAnchor : enemyAnchor;
    const to    = dir === 'toEnemy' ? enemyAnchor  : playerAnchor;
    // jogador dispara energia verde-amarela; inimigo dispara energia turquesa
    const color = dir === 'toEnemy'
      ? 'radial-gradient(circle at 35% 35%, #f4ffd6, #a6ee54 55%, #3c8f1c)'
      : 'radial-gradient(circle at 35% 35%, #d6fff4, #3fe0c8 55%, #0b7a8f)';
    const glow  = dir === 'toEnemy' ? 'rgba(150,232,79,0.9)' : 'rgba(63,224,200,0.9)';
    const ringColor = dir === 'toEnemy' ? '#a6ee54' : '#3fe0c8';
    setProj({ x: from.x, y: from.y, color, glow, moving: false, behind: dir === 'toEnemy' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setProj(p => p ? { ...p, x: to.x, y: to.y, moving: true } : p);
    }));
    // sai de trás do jogador → fica na frente após 160ms
    if (dir === 'toEnemy') setTimeout(() => setProj(p => p ? { ...p, behind: false } : p), 160);
    setTimeout(() => {
      setProj(null);
      setRing({ x: to.x, y: to.y, color: ringColor, key: ringKey.current++ });
      onArrive();
    }, 440);
  }

  useEffect(() => {
    if (!beat.intro) setLog(q.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === 'intro') {
      const t = setTimeout(() => { setLog(q.text); setPhase('question'); }, 2600);
      return () => clearTimeout(t);
    }
    if (phase === 'victory') {
      const t = setTimeout(() => { setLog(beat.success[0]); setSuccessIdx(0); setPhase('success'); }, 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function nextQuestion() {
    const nq = pickQuestion();
    setSelectedIdx(null); setWasCorrect(null);
    setEnemyAction('idle'); setPlayerAction('idle');
    setProj(null); setRing(null);
    setQ(nq); setLog(nq.text); setPhase('question');
  }

  function answer(idx: number) {
    if (phase !== 'question') return;
    setPhase('anim');
    const correct = idx === q.correctIdx;
    setSelectedIdx(idx);
    setWasCorrect(correct);

    const RAGE_THRESHOLD = ENEMY_MAX / 2;

    if (correct) {
      const newEHP = Math.max(0, enemyHp - HIT);
      setLog('✓ ' + pickFlavor(PLAYER_FLAVOR));
      playTone(660, 0.25, 'sine', 0.16);

      // 1.0s: jogador dispara projétil rumo ao inimigo (voa ~0.44s)
      setTimeout(() => {
        setPlayerAction('attack');
        playTone(520, 0.12, 'triangle', 0.1);
        playSfx('attack');
        launch('toEnemy', () => {
          setPlayerAction('idle');
          setEnemyHp(newEHP);
          setEnemyAction('hit');
          setShakeEnemy(true);
          setFlashEnemy(true);
          popDamage(enemyAnchor.x, enemyAnchor.y - 8, HIT, '#ff5a4a');
          playTone(180, 0.25, 'square', 0.12);
          setTimeout(() => { setShakeEnemy(false); setFlashEnemy(false); }, 480);
          // entra em fúria ao cruzar 50% do HP
          if (newEHP > 0 && newEHP <= RAGE_THRESHOLD) setEnemyRage(true);
        });
      }, 1000);

      setTimeout(() => {
        if (newEHP <= 0) {
          setEnemyAction('defeat');
          setPlayerAction('victory');
          setLog('A Consciência Verde te reconheceu!');
          playChord([523.25, 659.25, 783.99, 1046.5], 2.5, 0.1);
          playSfx('victory');
          recordSolved();
          onCorrect();
          setTimeout(() => setPhase('victory'), 1800);
          return;
        }
        // turno do inimigo: vibra, dispara projétil rumo ao jogador
        const raging = newEHP <= RAGE_THRESHOLD;
        const dmg = ENEMY_HIT + (raging ? 2 : 0);
        setEnemyAction('attack');
        if (raging && !rageAnnounced.current) {
          rageAnnounced.current = true;
          setLog('A Consciência Verde se enfurece! ' + pickFlavor(ENEMY_FLAVOR));
          playTone(90, 0.5, 'sawtooth', 0.15);
        } else {
          setLog(pickFlavor(ENEMY_FLAVOR));
        }
        setTimeout(() => {
          playTone(300, 0.12, 'triangle', 0.1);
          launch('toPlayer', () => {
            setPlayerAction('hit');
            setFlashPlayer(true); setShakePlayer(true);
            playTone(200, 0.3, 'sawtooth', 0.1);
            playSfx('hurt');
            setTimeout(() => { setFlashPlayer(false); setShakePlayer(false); setPlayerAction('idle'); }, 500);
            const newPHP = Math.max(0, playerHp - dmg);
            setPlayerHp(newPHP);
            popDamage(playerAnchor.x, playerAnchor.y - 8, dmg, '#ff5a4a');
            setTimeout(() => {
              if (newPHP <= 0) { setEnemyAction('victory'); setPlayerAction('defeat'); setLog('A floresta recusou você...'); setPhase('defeat'); }
              else nextQuestion();
            }, 900);
          });
        }, 700);
      }, 4400);
    } else {
      // Errou: inimigo ataca direto
      recordError();
      const raging = enemyRage;
      const dmg = WRONG_HIT + (raging ? 2 : 0);
      setEnemyAction('attack');
      setLog('✗ Errado! ' + pickFlavor(ENEMY_FLAVOR));
      playTone(110, 0.45, 'sawtooth', 0.14);

      setTimeout(() => {
        playTone(300, 0.12, 'triangle', 0.1);
        launch('toPlayer', () => {
          setPlayerAction('hit');
          const newPHP = Math.max(0, playerHp - dmg);
          setPlayerHp(newPHP);
          setFlashPlayer(true); setShakePlayer(true);
          popDamage(playerAnchor.x, playerAnchor.y - 8, dmg, '#ff5a4a');
          playTone(160, 0.35, 'sawtooth', 0.13);
          playSfx('hurt');
          setTimeout(() => { setFlashPlayer(false); setShakePlayer(false); setPlayerAction('idle'); }, 500);

          setTimeout(() => {
            if (newPHP <= 0) { setEnemyAction('victory'); setPlayerAction('defeat'); setLog('A floresta recusou você...'); setPhase('defeat'); }
            else nextQuestion();
          }, 1100);
        });
      }, 1100);
    }
  }

  function retry() {
    setPlayerHp(PLAYER_MAX); setEnemyHp(ENEMY_MAX);
    setPlayerAction('idle');
    setEnemyRage(false); rageAnnounced.current = false;
    nextQuestion();
  }

  function nextSuccess() {
    const next = successIdx + 1;
    if (next >= beat.success.length) { onSolved(); return; }
    setSuccessIdx(next); setLog(beat.success[next]);
  }

  const ePct = (enemyHp / ENEMY_MAX) * 100;
  const pPct = (playerHp / PLAYER_MAX) * 100;
  const hpCol = (pct: number) => pct > 50 ? '#58d048' : pct > 25 ? '#f8c030' : '#f04040';
  const fainting = enemyAction === 'defeat' && phase === 'victory';

  // Caixa de HP estilo Pokémon GBA (creme, borda oliva, relevo)
  const hpBox: React.CSSProperties = {
    position: 'absolute',
    background: 'linear-gradient(180deg,#f8f8e8 0%,#e0e0c4 100%)',
    border: '3px solid #383028', borderRadius: 7,
    boxShadow: 'inset 2px 2px 0 #fffff4, inset -2px -2px 0 #b8b89c, 2px 2px 0 rgba(0,0,0,0.28)',
    padding: '6px 12px 8px',
  };
  const hpLabel: React.CSSProperties = {
    fontSize: 10, color: '#f0a020', WebkitTextStroke: '0.4px #604010',
    fontStyle: 'italic', fontWeight: 700, marginRight: 4,
  };
  const hpTrack: React.CSSProperties = {
    flex: 1, height: 6, background: '#404038', borderRadius: 3,
    overflow: 'hidden', border: '1px solid #181810',
  };
  // Botões de resposta no estilo dos comandos do Pokémon (FIGHT/BAG/...)
  const OPT_COLORS = [
    { bg: '#ef5350', br: '#9e2622' }, // A vermelho
    { bg: '#f5a23a', br: '#a4641a' }, // B laranja
    { bg: '#52ab57', br: '#2c6e30' }, // C verde
    { bg: '#4f8ef0', br: '#27539e' }, // D azul
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', flexDirection: 'column' }}>

      {/* ── Arena ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden',
        background: '#6fb072' }}>

        {/* Fundo da batalha */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0,
          backgroundImage: `url('/escape-assets/corredor/battle-bg.jpg')`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          imageRendering: 'pixelated' }} />

        {/* Listras diagonais ao fundo (estilo VS do Pokémon) */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none', zIndex: 1,
          backgroundImage: 'repeating-linear-gradient(115deg, transparent 0, transparent 18px, rgba(255,255,255,0.10) 18px, rgba(255,255,255,0.10) 28px)',
          animation: 'battle-stripes 3.5s linear infinite' }} />

        {/* Projétil de energia voando até o alvo */}
        {proj && (
          <div style={{
            position: 'absolute', left: `${proj.x}%`, top: `${proj.y}%`,
            width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: '50%',
            background: proj.color,
            boxShadow: `0 0 18px 4px ${proj.glow}, 0 0 6px 2px ${proj.glow}`,
            zIndex: proj.behind ? 8 : 30, pointerEvents: 'none',
            transition: proj.moving ? 'left 0.44s cubic-bezier(0.45,0,0.7,1), top 0.44s cubic-bezier(0.45,0,0.7,1)' : 'none',
          }}>
            <div style={{ position: 'absolute', inset: 5, borderRadius: '50%',
              background: 'rgba(255,255,255,0.85)', animation: 'projectile-spin 0.5s linear infinite' }} />
          </div>
        )}

        {/* Anel de impacto ao acertar */}
        {ring && (
          <div key={ring.key} style={{
            position: 'absolute', left: `${ring.x}%`, top: `${ring.y}%`,
            width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: '50%',
            border: `4px solid ${ring.color}`, boxShadow: `0 0 14px ${ring.color}`,
            zIndex: 31, pointerEvents: 'none',
            animation: 'impact-ring 0.5s ease-out forwards',
          }} />
        )}

        {/* Números de dano flutuantes */}
        {dmgNums.map(d => (
          <div key={d.key} className="font-pixel" style={{
            position: 'absolute', left: `${d.x}%`, top: `${d.y}%`,
            transform: 'translateX(-50%)',
            fontSize: 26, fontWeight: 700, color: d.color,
            WebkitTextStroke: '1px #2a0808',
            textShadow: '0 2px 3px rgba(0,0,0,0.5)',
            zIndex: 32, pointerEvents: 'none',
            animation: 'dmg-float 0.9s ease-out forwards',
          }}>-{d.value}</div>
        ))}

        {/* Plataforma + sprite do inimigo — fundo direito */}
        <div style={{ position: 'absolute', top: '8%', right: 'calc(4% + 20px)', width: 190, height: 200,
          animation: 'battle-enemy-in 0.5s ease-out both' }}>
          {/* Glow pulsante azul-turquesa + wrapper de shake */}
          <div style={{
            position: 'absolute', bottom: -126, left: 0, right: 0,
            display: 'flex', justifyContent: 'center',
            animation: shakeEnemy ? 'enemy-hit-recoil 0.5s ease-out' : fainting ? 'battle-faint 1.4s ease-in forwards' : enemyAction === 'attack' ? `enemy-vibrate ${enemyRage ? 0.1 : 0.18}s linear infinite` : 'battle-float 2.8s ease-in-out infinite',
          }}>
            {/* Glow (ataque) + flash branco (dano) + tom de fúria */}
            <div style={{
              position: 'relative', display: 'inline-flex',
              animation: undefined,
              filter: flashEnemy ? 'brightness(1.8)' : undefined,
              transition: 'filter 0.05s',
            }}>
              {/* Todas as sprites pré-carregadas; só a ativa fica visível */}
              {([
                { key: 'idle-1',  src: '/escape-assets/enemies/consciencia-idle-1.png',  visible: enemyAction === 'idle' && !enemyRage && idleFrame === 1 },
                { key: 'idle-2',  src: '/escape-assets/enemies/consciencia-idle-2.png',  visible: enemyAction === 'idle' && !enemyRage && idleFrame === 2 },
                { key: 'rage-1',  src: '/escape-assets/enemies/consciencia-rage-1.png',  visible: enemyAction === 'idle' && enemyRage && rageFrame === 1 },
                { key: 'rage-2',  src: '/escape-assets/enemies/consciencia-rage-2.png',  visible: enemyAction === 'idle' && enemyRage && rageFrame === 2 },
                { key: 'rage-3',  src: '/escape-assets/enemies/consciencia-rage-3.png',  visible: enemyAction === 'idle' && enemyRage && rageFrame === 3 },
                { key: 'hit',     src: '/escape-assets/enemies/consciencia-hit.png',     visible: enemyAction === 'hit' },
                { key: 'attack',  src: '/escape-assets/enemies/consciencia-attack.png',  visible: enemyAction === 'attack' },
                { key: 'defeat',  src: '/escape-assets/enemies/consciencia-defeat.png',  visible: enemyAction === 'defeat' },
                { key: 'victory', src: '/escape-assets/enemies/consciencia-victory.png', visible: enemyAction === 'victory' },
              ] as const).map(({ key, src, visible }) => (
                <img
                  key={key}
                  src={src}
                  alt=""
                  style={{
                    height: 304, width: 'auto', imageRendering: 'pixelated',
                    display: visible ? 'block' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Caixa de HP do inimigo — canto superior esquerdo */}
        <div style={{ ...hpBox, top: 14, left: 12, minWidth: 196 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span className="font-pixel" style={{ fontSize: 12, color: '#282018' }}>Consciência Verde</span>
            <span className="font-pixel" style={{ fontSize: 9, color: '#6a5' }}>Lv??</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className="font-pixel" style={hpLabel}>HP</span>
            <div style={hpTrack}>
              <div style={{ width: `${ePct}%`, height: '100%', background: hpCol(ePct), transition: 'width 0.45s ease, background 0.45s' }} />
            </div>
          </div>
        </div>

        {/* Plataforma + sprite do jogador — frente esquerda */}
        <div style={{ position: 'absolute', bottom: 'calc(4% - 30px)', left: 'calc(4% - 30px)', width: 200, height: 175,
          animation: 'battle-player-in 0.5s ease-out both', zIndex: 10 }}>
          {/* Wrapper de shake (sem transform conflitante) */}
          <div style={{
            position: 'absolute', bottom: 16, left: 0, right: 0,
            display: 'flex', justifyContent: 'center',
            animation: shakePlayer ? 'battle-shake 0.4s ease' : playerAction === 'defeat' ? 'battle-faint 1.4s ease-in forwards' : 'battle-float 3.2s ease-in-out infinite',
          }}>
            <div style={{
              position: 'relative', display: 'inline-flex',
              filter: flashPlayer ? 'brightness(1.8)' : undefined,
              transition: 'filter 0.05s',
            }}>
              {([
                { key: 'idle-1',  src: '/escape-assets/chars/player-battle-idle-1.png',  visible: playerAction === 'idle' && idleFrame === 1 },
                { key: 'idle-2',  src: '/escape-assets/chars/player-battle-idle-2.png',  visible: playerAction === 'idle' && idleFrame === 2 },
                { key: 'hit',     src: '/escape-assets/chars/player-battle-hit.png',     visible: playerAction === 'hit' },
                { key: 'attack',  src: '/escape-assets/chars/player-battle-attack.png',  visible: playerAction === 'attack' },
                { key: 'defeat',  src: '/escape-assets/chars/player-battle-defeat.png',  visible: playerAction === 'defeat' },
                { key: 'victory', src: '/escape-assets/chars/player-battle-victory.png', visible: playerAction === 'victory' },
              ] as const).map(({ key, src, visible }) => (
                <img key={key} src={src} alt="" style={{
                  height: 254, width: 'auto', imageRendering: 'pixelated',
                  display: visible ? 'block' : 'none',
                }} />
              ))}
            </div>
          </div>
        </div>

        {/* Caixa de HP do jogador — canto inferior direito */}
        <div style={{ ...hpBox, bottom: 12, right: 12, minWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span className="font-pixel" style={{ fontSize: 12, color: '#282018' }}>Estudante</span>
            <span className="font-pixel" style={{ fontSize: 9, color: '#6a5' }}>Lv1</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
            <span className="font-pixel" style={hpLabel}>HP</span>
            <div style={hpTrack}>
              <div style={{ width: `${pPct}%`, height: '100%', background: hpCol(pPct), transition: 'width 0.45s ease, background 0.45s' }} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className="font-pixel" style={{ fontSize: 11, color: '#282018' }}>{playerHp}/{PLAYER_MAX}</span>
          </div>
        </div>

      </div>

      {/* ── Painel inferior: pergunta em cima, opções em baixo ── */}
      <div style={{ borderTop: '4px solid #202018', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg,#3a4a78 0%,#2a3658 100%)', padding: 12, gap: 10, minHeight: 240 }}>

        {/* Caixa da pergunta / mensagem */}
        <div style={{ background: 'linear-gradient(180deg,#f8f8f0,#e4e4d4)',
          border: '3px solid #383028', borderRadius: 8,
          boxShadow: 'inset 2px 2px 0 #fffff6, inset -2px -2px 0 #c0c0a4',
          padding: '12px 18px', minHeight: 62, display: 'flex', alignItems: 'center',
          justifyContent: phase === 'success' ? 'space-between' : 'flex-start' }}>
          <span className="font-pixel" style={{ fontSize: 12, color: '#282018', lineHeight: 1.7 }}>{log}</span>
          {phase === 'success' && (
            <button onClick={nextSuccess} style={{ background: 'transparent', border: 'none', cursor: 'pointer',
              flexShrink: 0, animation: 'hint-bob 1s ease-in-out infinite' }}>
              <span className="font-pixel" style={{ fontSize: 20, color: '#282018' }}>▼</span>
            </button>
          )}
        </div>

        {/* Grade 2×2 de alternativas — visível durante 'question' e 'anim' (para mostrar feedback) */}
        {(phase === 'question' || phase === 'anim') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 10, minHeight: 120 }}>
            {q.options.map((opt, i) => {
              const c = OPT_COLORS[i];
              // Durante anim: verde = resposta correta, vermelho = selecionada errada, resto escurecido
              let bg = c.bg, br = c.br, shadow = `inset 0 -4px 0 ${c.br}`;
              if (phase === 'anim') {
                if (i === q.correctIdx) {
                  bg = '#2e9e3a'; br = '#1a6024'; shadow = 'inset 0 -4px 0 #1a6024';
                } else if (i === selectedIdx && !wasCorrect) {
                  bg = '#c0392b'; br = '#7d1e1e'; shadow = 'inset 0 -4px 0 #7d1e1e';
                } else {
                  bg = '#888'; br = '#555'; shadow = 'inset 0 -4px 0 #555';
                }
              }
              const mark = phase === 'anim'
                ? (i === q.correctIdx ? ' ✓' : i === selectedIdx && !wasCorrect ? ' ✗' : '')
                : '';
              return (
                <button key={i} onClick={() => answer(i)} disabled={phase === 'anim'} style={{
                  background: bg, border: `3px solid ${br}`, borderRadius: 0,
                  boxShadow: shadow, cursor: phase === 'anim' ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
                  transition: 'background 0.2s, border-color 0.2s',
                }}>
                  <span className="font-pixel" style={{ fontSize: 13, color: '#fff', textShadow: '1px 1px 0 rgba(0,0,0,0.45)', flexShrink: 0 }}>{'ABCD'[i]}{mark}</span>
                  <span className="font-pixel" style={{ fontSize: 9, color: '#fff', lineHeight: 1.3, textShadow: '1px 1px 0 rgba(0,0,0,0.35)' }}>{opt}</span>
                </button>
              );
            })}
          </div>
        )}

        {phase === 'defeat' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
            <button onClick={retry} style={{ background: '#ef5350', border: '3px solid #9e2622',
              borderRadius: 0, boxShadow: 'inset 0 -4px 0 #9e2622', padding: '10px 28px', cursor: 'pointer' }}>
              <span className="font-pixel" style={{ fontSize: 12, color: '#fff', textShadow: '1px 1px 0 rgba(0,0,0,0.4)' }}>Tentar novamente</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ParallaxWorld({ bg, worldX, gateOpen, gateFrame, landmarkAnchor, nearby, boulderState, landmarkKind, appleTreeAnchor, trunkAnchor, conscienciaAnchor, computerOn, logsVisible, conscienciaDefeated }: { bg: SceneBg; worldX: number; gateOpen: boolean; gateFrame: number; landmarkAnchor: number | null; nearby: boolean; boulderState: BoulderState; landmarkKind: 'gate' | 'estufa-ext' | 'trunk' | 'computer' | 'consciencia' | 'lab'; appleTreeAnchor: number | null; trunkAnchor: number | null; conscienciaAnchor: number | null; computerOn: boolean; logsVisible: boolean; conscienciaDefeated?: boolean }) {
  if (bg === 'preto') {
    // tela preta lisa — usada no epílogo (ele já acordou no mundo real,
    // então o cenário do laboratório não deve mais aparecer atrás das falas)
    return <div style={{ position: 'absolute', inset: 0, background: '#000' }} />;
  }

  if (bg === 'noite') {
    return (
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, #0a1024 0%, #131a38 60%, #1c2440 100%)' }}>
        {Array.from({ length: 40 }, (_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i * 53) % 100}%`, top: `${(i * 37) % 70}%`,
            width: 2, height: 2, borderRadius: 9, background: '#fff',
            opacity: 0.3 + ((i * 7) % 10) / 14,
          }} />
        ))}
      </div>
    );
  }

  const fxLayer = (src: string, factor: number, z: number, extra?: CSSProperties): CSSProperties => ({
    position: 'absolute', inset: 0, zIndex: z,
    backgroundImage: `url('/escape-assets/forest/${src}')`,
    backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
    backgroundPositionX: `${Math.round(-worldX * factor)}px`, backgroundPositionY: 'bottom',
    imageRendering: 'pixelated', ...extra,
  });

  // helper genérico (caminho completo)
  const layer = (path: string, factor: number, z: number, extra?: CSSProperties): CSSProperties => ({
    position: 'absolute', inset: 0, zIndex: z,
    backgroundImage: `url('${path}')`,
    backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
    backgroundPositionX: `${Math.round(-worldX * factor)}px`, backgroundPositionY: 'bottom',
    imageRendering: 'pixelated', ...extra,
  });

  // ── Ato 3: montanhas + árvores teal/verde + Layer_0001_8 na frente ──
  if (bg === 'ato3') {
    const ATO3 = [
      { path: '/escape-assets/ato3/sky.png',            f: 0.03, z: 1 },
      { path: '/escape-assets/cute/bg2.png', f: 0.08, z: 2 },
      { path: '/escape-assets/cute/bg3.png',            f: 0.18, z: 3 },
      { path: '/escape-assets/ato3/trees-c.png',        f: 0.30, z: 4, extra: { backgroundSize: 'auto 480px' } },
      { path: '/escape-assets/ato3/trees-a.png',        f: 0.45, z: 5, extra: { backgroundSize: 'auto 500px' } },
      { path: '/escape-assets/ato3/trees-e.png',        f: 0.50, z: 6, extra: { backgroundSize: 'auto 500px', backgroundPositionY: 'bottom 0px' } },
      { path: '/escape-assets/ato3/trees-d.png',        f: 0.55, z: 7, extra: { backgroundSize: 'auto 500px', backgroundPositionY: 'bottom 10px' } },
      { path: '/escape-assets/forest/Layer_0001_8.png', f: 0.90, z: 9 },
    ];
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden',
        background: '#7dd8de' }}>

        {ATO3.map(l => <div key={l.path} style={layer(l.path, l.f, l.z, (l as {extra?: React.CSSProperties}).extra)} />)}

        {/* arbustos do Ato 3 */}
        {([
          { src: 'ato3/bush1.png', wx: 200,  f: 0.92, h: 80, b: GROUND - 4, z: 10 },
          { src: 'ato3/bush2.png', wx: 480,  f: 1.04, h: 55, b: GROUND - 4, z: 15 },
          { src: 'ato3/bush1.png', wx: 780,  f: 0.94, h: 72, b: GROUND - 4, z: 10, flip: true },
          { src: 'ato3/bush2.png', wx: 1050, f: 1.05, h: 50, b: GROUND - 4, z: 16 },
          { src: 'ato3/bush1.png', wx: 1350, f: 0.96, h: 76, b: GROUND - 4, z: 11, flip: true },
          { src: 'ato3/bush2.png', wx: 1620, f: 1.03, h: 52, b: GROUND - 4, z: 15 },
          { src: 'ato3/bush1.png', wx: 1900, f: 0.95, h: 70, b: GROUND - 4, z: 11 },
          { src: 'ato3/bush2.png', wx: 2180, f: 1.04, h: 48, b: GROUND - 4, z: 16, flip: true },
        ] as Prop[]).map((p, i) => <PropImg key={`ato3bush${i}`} p={p} worldX={worldX} />)}

        {/* chão texturizado */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND - 10, zIndex: 21,
          backgroundImage: `url('/escape-assets/world/ground-dark.png')`,
          backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
          backgroundPositionX: `${Math.round(-worldX * 1.0)}px`,
          imageRendering: 'pixelated',
        }} />

        {/* macieira — posição própria, persiste mesmo depois do collect */}
        {appleTreeAnchor != null && boulderState !== 'gone' && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(appleTreeAnchor - worldX)}px)`, bottom: GROUND - 4, zIndex: 12, transform: 'translateX(-50%)', width: 'max-content' }}>
            <img
              src="/escape-assets/ato3/apple-tree.png"
              alt="macieira gigante"
              style={{
                display: 'block', height: 460, width: 'auto', imageRendering: 'pixelated',
                filter: 'drop-shadow(0 12px 18px rgba(0,0,0,0.65))',
                transformOrigin: 'bottom center',
                animation: 'tree-sway 4s ease-in-out infinite',
              }}
            />
            {nearby && landmarkKind !== 'estufa-ext' && (
              <div className="font-pixel" style={{ position: 'absolute', bottom: 328, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
            )}
          </div>
        )}

        {/* estufa exterior — aparece quando o herói caminha para ela */}
        {landmarkAnchor != null && landmarkKind === 'estufa-ext' && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(landmarkAnchor - worldX)}px)`, bottom: GROUND - 4, zIndex: 12, transform: 'translateX(-50%)', width: 'max-content' }}>
            <div style={{ position: 'relative', display: 'inline-block', transform: 'translateY(45px)' }}>
              <img
                src="/escape-assets/ato3/estufa-ext.png"
                alt="estufa"
                style={{
                  display: 'block', height: 400, width: 'auto', imageRendering: 'pixelated',
                  filter: 'drop-shadow(0 12px 18px rgba(0,0,0,0.65))',
                }}
              />
              <img
                src="/escape-assets/ato3/estufa-light.png"
                alt=""
                style={{
                  position: 'absolute', bottom: 0, left: 0,
                  height: `calc(100vh - ${FLOOR + GROUND - 4}px)`,
                  width: '100%',
                  imageRendering: 'pixelated',
                  mixBlendMode: 'screen',
                  pointerEvents: 'none',
                  animation: 'light-pulse 2.4s ease-in-out infinite',
                }}
              />
            </div>

            {/* props ao redor da estufa — z:-1 atrás, z:13 na frente */}
            {([
              { src: '/escape-assets/ato3/bush2.png',          x: -30,  h: 52, z: -1 },
              { src: '/escape-assets/flora/shroom-big.png',    x:  90,  h: 48, z: -1 },
              { src: '/escape-assets/flora/flower-blue.png',   x: -80,  h: 36, z: 13 },
              { src: '/escape-assets/ato3/bush1.png',          x:  10,  h: 58, z: 13 },
              { src: '/escape-assets/flora/flower-purple.png', x:  80,  h: 38, z: 13 },
              { src: '/escape-assets/flora/shroom-small.png',  x: 140,  h: 32, z: 13 },
              { src: '/escape-assets/ato3/bush2.png',          x: 190,  h: 50, z: 13, flip: true },
              { src: '/escape-assets/flora/flower-tulip.png',  x: -30,  h: 38, z: 13 },
            ] as { src: string; x: number; h: number; z: number; flip?: boolean }[]).map((p, i) => (
              <img key={i} src={p.src} alt="" style={{
                position: 'absolute', bottom: 0, left: p.x,
                height: p.h, width: 'auto', imageRendering: 'pixelated',
                zIndex: p.z,
                transform: p.flip ? 'scaleX(-1)' : undefined,
                filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.5))',
              }} />
            ))}

            {nearby && (
              <div className="font-pixel" style={{ position: 'absolute', bottom: 408, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
            )}
          </div>
        )}

        <LightMotes />

        {/* grama de primeiro plano */}
        <div style={layer('/escape-assets/forest/Layer_0000_9.png', FOREST_FOREGROUND.f, 20,
          { transformOrigin: 'bottom center', animation: 'foliage-wind 4.2s ease-in-out infinite' })} />
      </div>
    );
  }

  if (bg === 'estufa') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden', background: '#060d07' }}>

        {/* camada 0 — céu e colinas (Legacy Fantasy) */}
        <div style={layer('/escape-assets/preview/legacy-bg.png', 0.03, 0, { backgroundSize: 'auto 100%', backgroundPositionY: 'bottom' })} />

        {/* jungle plx-3 */}
        <div style={layer('/escape-assets/jungle/plx-3.png', 0.14, 2, { backgroundSize: 'auto 350px' })} />
        {/* jungle plx-4 */}
        <div style={layer('/escape-assets/jungle/plx-4.png', 0.24, 3, { backgroundSize: 'auto 350px' })} />

        {/* camada 4 — guardião sombrio (atrás do interior) */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 4,
          height: 350,
          backgroundImage: "url('/escape-assets/estufa/guardian-dark.png')",
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 350px',
          backgroundPositionX: `${Math.round(-worldX * 0.22)}px`,
          backgroundPositionY: 'bottom',
          imageRendering: 'pixelated',
        }} />

        {/* camada 5 — interior da estufa (espelho alternado nos tiles) */}
        {(() => {
          const W = window.innerWidth || 400;
          const rawX = Math.round(-worldX * 0.08);
          const firstTile = Math.floor(-rawX / W) - 1;
          return [0, 1, 2, 3].map(di => {
            const n = firstTile + di;
            const x = rawX + n * W;
            return (
              <div key={n} style={{
                position: 'absolute', bottom: 0, zIndex: 5,
                left: x, width: W, height: 350,
                backgroundImage: "url('/escape-assets/estufa/bg-interior.png')",
                backgroundSize: 'auto 100%',
                backgroundRepeat: 'no-repeat',
                transform: Math.abs(n) % 2 !== 0 ? 'scaleX(-1)' : 'none',
              }} />
            );
          });
        })()}

        {/* camada 6 — plantas frente (chão) */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 6,
          height: 350,
          backgroundImage: "url('/escape-assets/estufa/plants-fg.png')",
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 350px',
          backgroundPositionX: `${Math.round(-worldX * 0.55)}px`,
          backgroundPositionY: 'bottom',
          imageRendering: 'pixelated',
        }} />

        {/* faixa preta — cobre tudo acima das camadas de 350px */}
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 350,
          zIndex: 7, pointerEvents: 'none',
          background: '#000',
        }} />


        {/* chão */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND - 10, zIndex: 21,
          backgroundImage: `url('/escape-assets/world/ground-dark.png')`,
          backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
          backgroundPositionX: `${Math.round(-worldX * 1.0)}px`,
          imageRendering: 'pixelated',
        }} />

        {/* partículas turquesa — nascem no tronco e vagam pela estufa */}
        <TrunkParticles trunkX={Math.round((trunkAnchor ?? landmarkAnchor ?? 0) - worldX)} />

        {/* partículas ambiente — flutuam por toda a estufa (2–5px) */}
        <EstufaAmbientParticles />

        {/* tronco persistente — permanece visível mesmo após avançar para o computador */}
        {trunkAnchor != null && landmarkKind !== 'trunk' && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(trunkAnchor - worldX)}px)`, bottom: GROUND - 4, zIndex: 11, transform: 'translateX(-50%)', width: 'max-content' }}>
            <div style={{ transform: 'translateY(30px)' }}><TrunkSprite height={330} /></div>
          </div>
        )}

        {/* landmarks: tronco pulsante ou computador */}
        {landmarkAnchor != null && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(landmarkAnchor - worldX)}px)`, bottom: GROUND - 4, zIndex: 12, transform: 'translateX(-50%)', width: 'max-content' }}>
            {landmarkKind === 'trunk' ? (
              <>
                <div style={{ transform: 'translateY(30px)' }}><TrunkSprite height={330} /></div>
                {nearby && (
                  <div className="font-pixel" style={{ position: 'absolute', bottom: 288, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
                )}
              </>
            ) : landmarkKind === 'computer' ? (
              <>
                <img
                  src={computerOn ? '/escape-assets/estufa/computer-on.png' : '/escape-assets/estufa/computer-off.png'}
                  alt="computador"
                  style={{ display: 'block', height: 220, width: 'auto', imageRendering: 'pixelated',
                    transform: 'translateY(20px)',
                    filter: computerOn ? undefined : 'drop-shadow(0 8px 14px rgba(0,0,0,0.7))',
                    animation: computerOn ? 'computer-glow-pulse 2.5s ease-in-out infinite' : undefined, }}
                />
                {nearby && (
                  <div className="font-pixel" style={{ position: 'absolute', bottom: 228, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* grama de primeiro plano */}
        <div style={{ ...fxLayer(FOREST_FOREGROUND.src, FOREST_FOREGROUND.f, 20), transformOrigin: 'bottom center', animation: 'foliage-wind 4.2s ease-in-out infinite' }} />

      </div>
    );
  }

  // ── Ato 5 — Pântano ───────────────────────────────────────────────────────
  const G = GROUND;
  const pantanoProps: { src: string; wx: number; f: number; h: number; b: number; z: number; flip?: boolean }[] = [
    // fundo distante — altos e pequenos
    { src: 'pantano/plant-tall.png', wx: 80,   f: 0.22, h: 80,  b: G + 80,  z: 6 },
    { src: 'pantano/plant-bush.png', wx: 340,  f: 0.25, h: 56,  b: G + 50,  z: 6, flip: true },
    { src: 'pantano/plant-tall.png', wx: 700,  f: 0.20, h: 76,  b: G + 90,  z: 6 },
    { src: 'pantano/plant-bush.png', wx: 1050, f: 0.23, h: 60,  b: G + 70,  z: 6, flip: true },
    { src: 'pantano/plant-tall.png', wx: 1400, f: 0.21, h: 72,  b: G + 85,  z: 6 },
    // meio — altura média
    { src: 'pantano/plant-tall.png', wx: 180,  f: 0.45, h: 120, b: G + 40,  z: 8 },
    { src: 'pantano/lily.png',       wx: 290,  f: 0.48, h: 50,  b: G + 25,  z: 8 },
    { src: 'pantano/plant-bush.png', wx: 530,  f: 0.43, h: 90,  b: G + 50,  z: 8 },
    { src: 'pantano/lily.png',       wx: 820,  f: 0.46, h: 45,  b: G + 30,  z: 8, flip: true },
    { src: 'pantano/plant-tall.png', wx: 1100, f: 0.44, h: 115, b: G + 45,  z: 8, flip: true },
    { src: 'pantano/plant-bush.png', wx: 1350, f: 0.47, h: 85,  b: G + 35,  z: 8 },
    // frente — perto do chão
    { src: 'pantano/lily.png',       wx: 430,  f: 0.75, h: 60,  b: G - 35,  z: 11 },
    { src: 'pantano/plant-tall.png', wx: 660,  f: 0.70, h: 140, b: G - 20,  z: 11 },
    { src: 'pantano/plant-bush.png', wx: 950,  f: 0.73, h: 95,  b: G - 22,  z: 11, flip: true },
    { src: 'pantano/plant-tall.png', wx: 1250, f: 0.71, h: 130, b: G - 32,  z: 11 },
  ];
  const frogPositions = [
    { wx: 290,  f: 0.48, z: 9,  b: G + 25 },
    { wx: 820,  f: 0.46, z: 9,  b: G + 30 },
  ];

  if (bg === 'pantano') {
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden' }}>
        <img src="/escape-assets/pantano/bg.png" alt="" style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: 'calc(100% + 200px)',
          objectFit: 'cover', objectPosition: 'center top',
          zIndex: 0, imageRendering: 'pixelated',
        }} />

        {/* camada_4b — hills2 (atrás de hills, 200px abaixo) */}
        <div style={layer('/escape-assets/pantano/hills2.png', 0.03, 0, { backgroundSize: 'auto 350px' })} />

        {/* camada_4 — hills (mais distante, move menos) */}
        <div style={layer('/escape-assets/pantano/hills.png', 0.05, 1, { backgroundSize: 'auto 350px' })} />

        {/* camada_3 — back-silh */}
        <div style={layer('/escape-assets/pantano/back-silh.png', 0.18, 2, { backgroundSize: 'auto 350px', backgroundPositionY: 'bottom' })} />

        {/* camada_2 — mix-trees */}
        <div style={layer('/escape-assets/pantano/mix-trees.png', 0.40, 3, { backgroundSize: 'auto 350px', backgroundPositionY: 'calc(100% + 5px)' })} />

        {/* jacaré único — passa, pausa fora da cena, vira e volta */}
        <div style={{ position: 'absolute', bottom: GROUND + 70, zIndex: 3, left: 0, pointerEvents: 'none',
          animation: 'croc-pass 150s linear infinite' }}>
          <img src="/escape-assets/pantano/croc.png" alt="" style={{ height: 61, width: 'auto', imageRendering: 'pixelated', animation: 'croc-bob 4s ease-in-out infinite' }} />
        </div>

        {/* camada_1 — dead-trees (mais próxima, move mais) */}
        <div style={layer('/escape-assets/pantano/dead-trees.png', 0.70, 4, { backgroundSize: 'auto 350px' })} />

        {/* troncos caídos — surgem após sequência correta */}
        {logsVisible && (
          <div style={{ ...layer('/escape-assets/pantano/logs.png', 0.85, 5, { backgroundSize: 'auto 350px', backgroundPositionY: 'calc(100% + 30px)' }), animation: 'logs-rise 1.2s ease-out forwards' }} />
        )}

        {/* camada_0 — ground-fg (ancorada ao início do pântano, não repete) */}
        <div style={layer('/escape-assets/pantano/ground-fg.png', 1.0, 6, { backgroundSize: 'auto 350px', backgroundRepeat: 'no-repeat', backgroundPositionY: 'calc(100% + 30px)' })} />

        {/* plantas e vitórias-régias espalhadas */}
        {pantanoProps.map((p, i) => {
          const sx = Math.round(p.wx - worldX * p.f);
          const vw = typeof window !== 'undefined' ? window.innerWidth : 900;
          if (sx > vw + 200 || sx < -200) return null;
          const swayDur = 3 + (i % 5) * 0.7;
          const swayDelay = -(i * 1.3 % swayDur);
          const isLily = p.src.includes('lily');
          return (
            <div key={`pp${i}`} style={{ position: 'absolute', left: sx, bottom: p.b, zIndex: p.z, transform: p.flip ? 'scaleX(-1)' : undefined }}>
              <img src={`/escape-assets/${p.src}`} alt="" style={{
                height: p.h, width: 'auto', imageRendering: 'pixelated', display: 'block',
                transformOrigin: 'bottom center',
                animation: isLily ? undefined : `plant-sway ${swayDur}s ease-in-out ${swayDelay}s infinite`,
              }} />
            </div>
          );
        })}

        {/* sapos animados sobre vitórias-régias */}
        {frogPositions.map((fp, i) => {
          const sx = Math.round(fp.wx - worldX * fp.f);
          const vw = typeof window !== 'undefined' ? window.innerWidth : 900;
          if (sx > vw + 200 || sx < -200) return null;
          const dur = 1.8 + i * 0.7;
          return (
            <div key={`frog${i}`} style={{ position: 'absolute', left: sx, bottom: fp.b, zIndex: fp.z, width: 80, height: 70 }}>
              <img src="/escape-assets/pantano/frog1.png" alt="" style={{ position: 'absolute', inset: 0, height: 70, width: 'auto', imageRendering: 'pixelated', animation: `frog-frame ${dur}s steps(1) infinite` }} />
              <img src="/escape-assets/pantano/frog2.png" alt="" style={{ position: 'absolute', inset: 0, height: 70, width: 'auto', imageRendering: 'pixelated', animation: `frog-frame2 ${dur}s steps(1) infinite` }} />
            </div>
          );
        })}
      </div>
    );
  }

  // ── Atos 6-7: cenas de imagem única (corredor de luz / final) ─────────────
  if (bg === 'corredor' || bg === 'final') {
    const CSPEEDS = [0.01, 0.02, 0.04, 0.06, 0.09, 0.12, 0.16, 0.22];
    // parallax speeds do lab final +20%
    const FSPEEDS: Record<number, number> = { 1: 0.012, 2: 0.048, 3: 0.12, 5: 0.216, 6: 0.072, 7: 0.264 };
    return (
      <>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden',
        background: bg === 'corredor' ? '#1a0e2e' : '#e8a060' }}>

        {/* ── Corredor: 8 camadas parallax ── */}
        {bg === 'corredor' && [1,2,3,4,5,6,7,8].map((n, i) => (
          <div key={n} style={n === 1 ? {
            position: 'absolute', inset: 0, zIndex: 1,
            backgroundImage: `url('/escape-assets/corredor/layer-1.png')`,
            backgroundSize: 'cover', backgroundPositionY: 'center',
            backgroundPositionX: `${Math.round(-worldX * CSPEEDS[0])}px`,
            imageRendering: 'pixelated',
          } : {
            position: 'absolute', inset: 0, zIndex: n,
            backgroundImage: `url('/escape-assets/corredor/layer-${n}.png')`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: 'auto 350px',
            backgroundPositionX: `${Math.round(-worldX * CSPEEDS[i])}px`,
            backgroundPositionY: 'bottom -50px',
            imageRendering: 'pixelated',
            ...(n === 4 ? { mixBlendMode: 'screen', animation: 'sunlight-pulse 4s ease-in-out infinite' } : {}),
            ...(n === 6 ? { mixBlendMode: 'screen', animation: 'sunlight-pulse 5.5s ease-in-out infinite' } : {}),
          }} />
        ))}
        {bg === 'corredor' && [18, 38, 58, 78].map((lx, i) => (
          <div key={i} style={{
            position: 'absolute', top: '-10%', left: `${lx}%`, width: 60, height: '120%', zIndex: 3,
            transform: 'rotate(8deg)', transformOrigin: 'top center', pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(255,200,80,0.7), transparent 75%)',
            filter: 'blur(8px)',
            animation: `beam-pulse ${4 + i}s ease-in-out ${-i}s infinite`,
          }} />
        ))}
        {bg === 'corredor' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 9, pointerEvents: 'none',
            background: 'rgba(255,160,40,0.15)' }} />
        )}
        {bg === 'corredor' && <LightMotes kind="sunset" />}

        {/* ── Lab Final: faixa preta acima dos 350px do fundo ── */}
        {bg === 'final' && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 350, zIndex: 10, background: '#000', pointerEvents: 'none' }} />
        )}

        {/* ── Lab Final: camadas 1-3 (dentro do container) ── */}
        {bg === 'final' && [1, 2, 3].map((n) => (
          <div key={n} style={n === 1 ? {
            // camada 1: céu gradiente — cover, mais lento
            position: 'absolute', inset: 0, zIndex: 1,
            backgroundImage: `url('/escape-assets/final/layer-1.png')`,
            backgroundSize: 'cover', backgroundPositionY: 'center',
            backgroundPositionX: `${Math.round(-worldX * FSPEEDS[1])}px`,
            imageRendering: 'pixelated',
          } : {
            // camadas 2-3: ancoradas no fundo
            position: 'absolute', inset: 0, zIndex: n,
            backgroundImage: `url('/escape-assets/final/layer-${n}.png')`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: 'auto 380px',
            backgroundPositionX: `${Math.round(-worldX * FSPEEDS[n])}px`,
            backgroundPositionY: 'bottom 0px',
            imageRendering: 'pixelated',
          }} />
        ))}

        {/* Inimigo VIVO: Consciência Verde — entra deslizando pela direita (parallax do cenário) */}
        {bg === 'corredor' && !conscienciaDefeated && landmarkAnchor != null && landmarkKind === 'consciencia' && (
          <div style={{
            position: 'absolute',
            left: `calc(34% + ${Math.round(landmarkAnchor - worldX * 0.22)}px)`,
            bottom: GROUND - 20, zIndex: 13,
            width: 168, height: 300,
            transform: 'translateX(-50%) scaleX(-1)',
            filter: 'drop-shadow(0 0 12px rgba(60,255,140,0.8))',
          }}>
            <img src="/escape-assets/corredor/consciencia-idle-1.png" alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                animation: 'butterfly-frame 0.6s steps(1) infinite' }} />
            <img src="/escape-assets/corredor/consciencia-idle-2.png" alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                animation: 'butterfly-frame2 0.6s steps(1) infinite' }} />
          </div>
        )}

        {/* Inimigo DERROTADO: persiste na cena (mesmo após o herói seguir para o lab),
            recua lentamente conforme o herói vai embora */}
        {bg === 'corredor' && conscienciaDefeated && conscienciaAnchor != null && (
          <div style={{
            position: 'absolute',
            left: `calc(34% + ${Math.round(conscienciaAnchor - worldX * 0.22)}px)`,
            bottom: GROUND - 20, zIndex: 13,
            width: 168, height: 300,
            transform: 'translateX(-50%) scaleX(-1)',
            filter: 'drop-shadow(0 0 12px rgba(120,200,255,0.6))',
          }}>
            <img src="/escape-assets/corredor/consciencia-defeated.png" alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />
          </div>
        )}

        {/* ── Lab Final: raios de luz dourados ── */}
        {bg === 'final' && [15, 35, 55, 75].map((lx, i) => (
          <div key={i} style={{
            position: 'absolute', top: '-10%', left: `${lx}%`, width: 55, height: '120%', zIndex: 8,
            transform: 'rotate(6deg)', transformOrigin: 'top center', pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(255,220,100,0.65), transparent 70%)',
            filter: 'blur(9px)',
            animation: `beam-pulse ${4.5 + i * 0.8}s ease-in-out ${-i * 1.2}s infinite`,
          }} />
        ))}

        {/* ── Lab Final: partículas de luz ── */}
        {bg === 'final' && <LightMotes kind="sunset" />}

        {/* ── Lab Final: gradiente radial de sol ── */}
        {bg === 'final' && (
          <div style={{
            position: 'absolute', zIndex: 9, pointerEvents: 'none',
            left: '18%', top: '8%',
            width: 420, height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(255,240,140,0.95) 0%, rgba(255,190,50,0.6) 35%, rgba(255,140,20,0.25) 60%, transparent 80%)',
            mixBlendMode: 'screen',
            filter: 'blur(18px)',
            animation: 'sunlight-pulse 5s ease-in-out infinite',
          }} />
        )}

      </div>
      {bg === 'corredor' && <CorredorButterflies />}
      {bg === 'final' && <CorredorButterflies />}
      {/* prédio do laboratório — fora do container para não ser cortado pelo overflow:hidden */}
      {bg === 'corredor' && landmarkAnchor != null && landmarkKind === 'lab' && (
        <img src="/escape-assets/corredor/lab.png" alt="laboratório" style={{
          position: 'absolute', left: `calc(50% + ${Math.round(landmarkAnchor - worldX + 50)}px)`,
          bottom: FLOOR + GROUND - 67, zIndex: 12, transform: 'translateX(-50%)',
          height: 500, width: 1010, display: 'block',
          filter: 'drop-shadow(0 0 30px rgba(120,200,255,0.35))',
        }} />
      )}
      {/* Foreground corredor — fora do container */}
      {bg === 'corredor' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 25, pointerEvents: 'none',
          backgroundImage: `url('/escape-assets/corredor/layer-fg.png')`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 350px',
          backgroundPositionX: `${Math.round(-worldX * 0.28)}px`,
          backgroundPositionY: 'bottom 11px',
          imageRendering: 'pixelated',
        }} />
      )}
      {/* Camada 6 do lab (sol) — uma camada acima do herói (zIndex 15) */}
      {bg === 'final' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none',
          backgroundImage: `url('/escape-assets/final/layer-6.png')`,
          backgroundSize: 'auto 532px',
          backgroundRepeat: 'repeat-x',
          backgroundPositionX: `${Math.round(-worldX * FSPEEDS[6]) - 260}px`,
          backgroundPositionY: 'calc(50% - 60px)',
          imageRendering: 'pixelated',
          mixBlendMode: 'screen',
          filter: 'brightness(2) saturate(1.5)',
          animation: 'sunlight-pulse 4s ease-in-out infinite',
        }} />
      )}
      {/* Camada 7 do lab — na frente do herói (zIndex 17) */}
      {bg === 'final' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 17, pointerEvents: 'none',
          backgroundImage: `url('/escape-assets/final/layer-7.png')`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 281px',
          backgroundPositionX: `${Math.round(-worldX * FSPEEDS[7])}px`,
          backgroundPositionY: 'bottom 274px',
          imageRendering: 'pixelated',
        }} />
      )}
      {/* Camada 5 (vinhas) — zIndex 16 */}
      {bg === 'final' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 16, pointerEvents: 'none',
          backgroundImage: `url('/escape-assets/final/layer-5.png')`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 351px',
          backgroundPositionX: `${Math.round(-worldX * FSPEEDS[5])}px`,
          backgroundPositionY: 'bottom 302px',
          imageRendering: 'pixelated',
          transformOrigin: 'top center',
          animation: 'vine-sway 3.5s ease-in-out infinite',
        }} />
      )}

      </>
    );
  }

  // ── Ato 1 — Tall Forest (3 camadas parallax) ──────────────────────────────
  if (bg === 'floresta') {
    const TF = [
      { src: '/escape-assets/jungle/plx-2.png',          f: 0.06 },
      { src: '/escape-assets/jungle/plx-3.png',          f: 0.20 },
      { src: '/escape-assets/jungle/plx-4.png',          f: 0.50 },
      { src: '/escape-assets/jungle/plx-5.png',          f: 0.70 },
      { src: '/escape-assets/tallforest/far-custom.png', f: 0.78 },
      { src: '/escape-assets/tallforest/middle.png',     f: 0.85 },
    ];
    const BUSHES: Prop[] = [
      { src: 'tallforest/bush3.png', wx: 160,  f: 0.92, h: 72, b: GROUND - 4, z: 9,  glow: true },
      { src: 'tallforest/bush4.png', wx: 420,  f: 1.04, h: 48, b: GROUND - 4, z: 15 },
      { src: 'tallforest/bush2.png', wx: 680,  f: 0.94, h: 80, b: GROUND - 4, z: 8, flip: true },
      { src: 'tallforest/bush1.png', wx: 950,  f: 1.05, h: 70, b: GROUND - 4, z: 16 },
      { src: 'tallforest/bush3.png', wx: 1200, f: 0.96, h: 65, b: GROUND - 4, z: 11, flip: true, glow: true },
      { src: 'tallforest/bush4.png', wx: 1460, f: 1.03, h: 52, b: GROUND - 4, z: 17 },
      { src: 'tallforest/bush2.png', wx: 1720, f: 0.93, h: 75, b: GROUND - 4, z: 9  },
      { src: 'tallforest/bush1.png', wx: 1980, f: 1.06, h: 68, b: GROUND - 4, z: 15 },
      { src: 'tallforest/bush3.png', wx: 2240, f: 0.95, h: 70, b: GROUND - 4, z: 11, glow: true },
      { src: 'tallforest/bush4.png', wx: 2520, f: 1.04, h: 45, b: GROUND - 4, z: 16, flip: true },
    ];
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden',
        background: 'linear-gradient(to bottom, #0d1a0d 0%, #122212 40%, #1a2e18 100%)' }}>

        {/* camada 1 — céu (Grassland Free) */}
        <div style={layer('/escape-assets/preview/legacy-bg.png', 0.03, 0, { backgroundSize: 'auto 100%', backgroundPositionY: 'bottom' })} />

        {TF.map((l, i) => (
          <div key={l.src} style={layer(l.src, l.f, i + 1, { backgroundSize: 'auto 350px' })} />
        ))}

        {/* camada 8 — subida 40px */}
        <div style={layer('/escape-assets/tallforest/layer8-custom.png', 0.76, 12, { backgroundPositionY: 'bottom 40px' })} />
        {/* camada 9 — atrás do herói */}
        <div style={fxLayer('Layer_0001_8.png', 0.90, 13)} />

        <LightMotes />

        {/* chão */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND - 10, zIndex: 10,
          backgroundImage: `url('/escape-assets/world/ground-dark.png')`,
          backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
          backgroundPositionX: `${Math.round(-worldX * 1.0)}px`,
          imageRendering: 'pixelated',
        }} />

        {/* arbustos — distribuídos por z-index (atrás e frente do herói) */}
        {BUSHES.map((p, i) => <PropImg key={`bush${i}`} p={p} worldX={worldX} />)}

        {/* camada 10 — grama, na frente do herói */}
        <div style={fxLayer('Layer_0000_9.png', FOREST_FOREGROUND.f, 20,
          { transformOrigin: 'bottom center', animation: 'foliage-wind 4.2s ease-in-out infinite' })} />

        {/* portão */}
        {landmarkAnchor != null && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(landmarkAnchor - worldX)}px)`, bottom: GROUND - 24, zIndex: 12, transform: 'translateX(-50%)', width: 'max-content' }}>
            <img
              src={gateFrame >= 1 ? '/escape-assets/tallforest/gate-open.png' : '/escape-assets/tallforest/gate-closed.png'}
              alt="portão"
              style={{ display: 'block', height: 200, width: 'auto', imageRendering: 'pixelated', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.7))' }}
            />
            {nearby && !gateOpen && (
              <div className="font-pixel" style={{ position: 'absolute', bottom: 210, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (bg === 'clareira') {
    const TF = [
      { src: '/escape-assets/jungle/plx-2.png',        f: 0.06 },
      { src: '/escape-assets/jungle/plx-3.png',        f: 0.20 },
      { src: '/escape-assets/jungle/plx-4.png',        f: 0.50 },
      { src: '/escape-assets/jungle/plx-5.png',        f: 0.70 },
      { src: '/escape-assets/tallforest/far-custom.png', f: 0.78 },
      { src: '/escape-assets/tallforest/middle.png',   f: 0.85 },
    ];
    const BUSHES: Prop[] = [
      { src: 'tallforest/bush3.png', wx: 160,  f: 0.92, h: 72, b: GROUND - 4, z: 9,  glow: true },
      { src: 'tallforest/bush4.png', wx: 420,  f: 1.04, h: 48, b: GROUND - 4, z: 15 },
      { src: 'tallforest/bush2.png', wx: 680,  f: 0.94, h: 80, b: GROUND - 4, z: 8, flip: true },
      { src: 'tallforest/bush1.png', wx: 950,  f: 1.05, h: 70, b: GROUND - 4, z: 16 },
      { src: 'tallforest/bush3.png', wx: 1200, f: 0.96, h: 65, b: GROUND - 4, z: 11, flip: true, glow: true },
      { src: 'tallforest/bush4.png', wx: 1460, f: 1.03, h: 52, b: GROUND - 4, z: 17 },
      { src: 'tallforest/bush2.png', wx: 1720, f: 0.93, h: 75, b: GROUND - 4, z: 9  },
      { src: 'tallforest/bush1.png', wx: 1980, f: 1.06, h: 68, b: GROUND - 4, z: 15 },
      { src: 'tallforest/bush3.png', wx: 2240, f: 0.95, h: 70, b: GROUND - 4, z: 11, glow: true },
      { src: 'tallforest/bush4.png', wx: 2520, f: 1.04, h: 45, b: GROUND - 4, z: 16, flip: true },
    ];
    return (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden',
        background: 'linear-gradient(to bottom, #0d1a0d 0%, #122212 40%, #1a2e18 100%)' }}>

        {/* camada 1 — céu (Grassland Free) */}
        <div style={layer('/escape-assets/preview/legacy-bg.png', 0.03, 0, { backgroundSize: 'auto 100%', backgroundPositionY: 'bottom' })} />

        {TF.map((l, i) => (
          <div key={l.src} style={layer(l.src, l.f, i + 1, { backgroundSize: 'auto 350px' })} />
        ))}

        {/* guardião — atrás do layer8-custom (z:12), renderizado antes dele no DOM */}
        {landmarkAnchor != null && boulderState !== 'idle' && (
          <div style={{
            position: 'absolute',
            left: `calc(50% + ${Math.round(landmarkAnchor + 950 - worldX)}px)`,
            bottom: GROUND - 4,
            zIndex: 11,
            transform: 'translateX(-50%)',
            width: 'max-content',
          }}>
            <GuardianSprite />
          </div>
        )}

        {/* camada 8 — subida 40px */}
        <div style={layer('/escape-assets/tallforest/layer8-custom.png', 0.76, 12, { backgroundPositionY: 'bottom 40px' })} />
        {/* camada 9 — atrás do herói */}
        <div style={fxLayer('Layer_0001_8.png', 0.90, 13)} />

        <LightMotes />

        {/* arbustos */}
        {BUSHES.map((p, i) => <PropImg key={`bush${i}`} p={p} worldX={worldX} />)}

        {/* flora mágica */}
        {SCENERY.map((p, i) => <PropImg key={`flora${i}`} p={p} worldX={worldX} />)}

        {/* chão */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND - 10, zIndex: 10,
          backgroundImage: `url('/escape-assets/world/ground-dark.png')`,
          backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
          backgroundPositionX: `${Math.round(-worldX * 1.0)}px`,
          imageRendering: 'pixelated',
        }} />

        {/* camada 10 — grama, na frente do herói */}
        <div style={fxLayer('Layer_0000_9.png', FOREST_FOREGROUND.f, 20,
          { transformOrigin: 'bottom center', animation: 'foliage-wind 4.2s ease-in-out infinite' })} />

        {/* pedra gigante */}
        {landmarkAnchor != null && boulderState !== 'gone' && (
          <div style={{ position: 'absolute', left: `calc(50% + ${Math.round(landmarkAnchor - worldX)}px)`, bottom: GROUND - 44, zIndex: 16, transform: 'translateX(-50%)', width: 'max-content' }}>
            <div style={{
              transform: boulderState === 'sinking' ? 'translateY(360px)' : 'translateY(0)',
              transition: boulderState === 'sinking' ? 'transform 1.4s ease-in' : 'none',
            }}>
              <img
                src="/escape-assets/world/boulder.png"
                alt="pedra gigante"
                style={{
                  display: 'block', height: 240, width: 'auto', imageRendering: 'pixelated',
                  filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.9)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',
                  animation: boulderState === 'shaking' ? 'boulder-shake 0.13s ease-in-out infinite' : 'none',
                }}
              />
            </div>
            {nearby && boulderState === 'idle' && (
              <div className="font-pixel" style={{ position: 'absolute', bottom: 248, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
            )}
          </div>
        )}

      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FLOOR, overflow: 'hidden', background: '#5a6f8c' }}>
      {/* camadas da floresta (trás → frente, atrás do herói) */}
      {(bg === 'clareira' ? CLAREIRA_LAYERS : FOREST_LAYERS).map((l, i) => (
        <div key={l.src} style={fxLayer(l.src, l.f, i + 1)} />
      ))}

      {/* nuvens — acima de todas as camadas de floresta (z=11), ficam no céu */}
      {[
        { src: 'cloud1.png', f: 0.04, topPx: 14, h: 52, offset: 0,   op: 0.75 },
        { src: 'cloud2.png', f: 0.06, topPx: 44, h: 42, offset: 340, op: 0.50 },
        { src: 'cloud3.png', f: 0.03, topPx: 72, h: 36, offset: 680, op: 0.28 },
      ].map(c => (
        <div key={c.src} style={{
          position: 'absolute', left: 0, right: 0, top: 0, height: '45%',
          zIndex: 12,
          backgroundImage: `url('/escape-assets/world/${c.src}')`,
          backgroundRepeat: 'repeat-x', backgroundSize: `auto ${c.h}px`,
          backgroundPositionX: `${Math.round(-worldX * c.f - c.offset)}px`,
          backgroundPositionY: `${c.topPx}px`,
          imageRendering: 'pixelated', opacity: c.op,
        }} />
      ))}

      {/* flora mágica — z-index decide quem fica atrás (z<14) ou na frente (14<z<20) do herói */}
      {SCENERY.map((p, i) => <PropImg key={`flora${i}`} p={p} worldX={worldX} />)}

      {/* chão texturizado — acima da grama de primeiro plano (z=20) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND - 10,
        zIndex: 21,
        backgroundImage: `url('/escape-assets/world/ground-dark.png')`,
        backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
        backgroundPositionX: `${Math.round(-worldX * 1.0)}px`,
        imageRendering: 'pixelated',
      }} />

      {/* marco do mundo: pedra (clareira) ou portão (floresta) */}
      {landmarkAnchor != null && (
        <div style={{
          position: 'absolute',
          left: `calc(50% + ${Math.round(landmarkAnchor - worldX)}px)`,
          bottom: GROUND - 4, zIndex: 12, transform: 'translateX(-50%)',
          width: 'max-content',
        }}>
          {bg === 'clareira' ? (
            boulderState !== 'gone' && (
              <>
                {/* wrapper de sinking — translateY separado do shake */}
                <div style={{
                  transform: boulderState === 'sinking' ? 'translateY(360px)' : 'translateY(0)',
                  transition: boulderState === 'sinking' ? 'transform 1.4s ease-in' : 'none',
                }}>
                  <img
                    src="/escape-assets/world/boulder.png"
                    alt="pedra gigante"
                    style={{
                      display: 'block', height: 240, width: 'auto', imageRendering: 'pixelated',
                      filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.9)) drop-shadow(0 0 8px rgba(0,0,0,0.6))',
                      animation: boulderState === 'shaking' ? 'boulder-shake 0.13s ease-in-out infinite' : 'none',
                    }}
                  />
                </div>
                {nearby && boulderState === 'idle' && (
                  <div className="font-pixel" style={{ position: 'absolute', bottom: 248, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
                )}
              </>
            )
          ) : (
            <>
              <img
                src={gateFrame === 2 ? '/escape-assets/world/gate-open.png'
                   : gateFrame === 1 ? '/escape-assets/world/gate-half.png'
                   : '/escape-assets/world/gate-closed.png'}
                alt="portão"
                style={{ display: 'block', height: 200, width: 'auto', imageRendering: 'pixelated', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.7))' }}
              />
              {nearby && !gateOpen && (
                <div className="font-pixel" style={{ position: 'absolute', bottom: 210, left: '50%', transform: 'translateX(-50%)', color: '#ffe070', fontSize: 18, textShadow: '0 2px 4px #000', animation: 'hint-bob 1s ease-in-out infinite' }}>❗</div>
              )}
            </>
          )}
        </div>
      )}

      {/* poeira de luz mágica */}
      <LightMotes />

      {/* grama/mato em primeiro plano — NA FRENTE do herói, balança ao vento */}
      <div style={{ ...fxLayer(FOREST_FOREGROUND.src, FOREST_FOREGROUND.f, 20), transformOrigin: 'bottom center', animation: 'foliage-wind 4.2s ease-in-out infinite' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Criatura ambiente — atravessa a tela uma vez
// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
// Criatura ambiente (raposa de musgo) — aparece após delay, passa uma vez
// ─────────────────────────────────────────────────────────
function WalkingRabbit({ onDone }: { onDone: () => void }) {
  const [left, setLeft] = useState(-120);
  const [frame, setFrame] = useState(0);
  const posRef = useRef(-120);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // frames animam imediatamente na montagem
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 160);
    return () => clearInterval(id);
  }, []);

  // caminha da esquerda para direita uma única vez
  useEffect(() => {
    let prev = 0;
    let raf: number;
    const tick = (t: number) => {
      const dt = prev ? (t - prev) / 1000 : 0;
      prev = t;
      posRef.current += 80 * dt;
      setLeft(posRef.current);
      if (posRef.current > window.innerWidth + 120) { onDoneRef.current(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <img src={`/escape-assets/creatures/fox-walk-${frame + 1}.png`} alt=""
      style={{
        position: 'absolute', left, bottom: FLOOR + GROUND,
        height: 70, width: 'auto', imageRendering: 'pixelated',
        zIndex: 13,
        filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.45))',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────
// Herói — normal e despertar
// ─────────────────────────────────────────────────────────
function WakeUpHero({ frame }: { frame: number }) {
  return (
    <img src={`/escape-assets/chars/wakeup-${frame}.png`} alt="herói acordando"
      style={{
        position: 'absolute', left: '34%', bottom: FLOOR + GROUND + HERO_LIFT, zIndex: 14,
        height: 88, width: 'auto', imageRendering: 'pixelated',
        transform: 'translateX(-50%)',
        filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.5))',
      }} />
  );
}

function Hero({ moving, frame, facing, groundOffset = 0 }: { moving: boolean; frame: number; facing: number; groundOffset?: number }) {
  const src = moving
    ? `/escape-assets/chars/player-walk-${(frame % 3) + 1}.png`
    : `/escape-assets/chars/player-idle-${(frame % 2) + 1}.png`;
  return (
    <img src={src} alt="herói"
      style={{
        position: 'absolute', left: '34%', bottom: FLOOR + GROUND + HERO_LIFT + groundOffset, zIndex: 14,
        height: 126, width: 'auto', imageRendering: 'pixelated',
        transform: `translateX(-50%) scaleX(${facing})`,
        filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.5))',
        transition: 'bottom 80ms linear',
      }} />
  );
}

// ─────────────────────────────────────────────────────────
// Editor de terreno — só aparece em DEV/test
// ─────────────────────────────────────────────────────────
const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test');

function TerrainEditorPanel({ worldX, zones, onAdd, onRemove }: {
  worldX: number;
  zones: TerrainZone[];
  onAdd: (z: TerrainZone) => void;
  onRemove: (x: number) => void;
}) {
  const [height, setHeight] = useState('60');
  const [type, setType] = useState<'step' | 'ramp'>('step');
  const [rampLen, setRampLen] = useState('200');
  const [copied, setCopied] = useState(false);

  const mark = () => {
    const x = Math.round(worldX);
    const y = parseInt(height) || 0;
    const ramp = type === 'ramp' ? (parseInt(rampLen) || 200) : undefined;
    onAdd({ x, y, ramp });
  };

  const copyCode = () => {
    const sorted = [...zones].sort((a, b) => a.x - b.x);
    const lines = sorted.map(z =>
      z.ramp
        ? `  { x: ${z.x}, y: ${z.y}, ramp: ${z.ramp} },`
        : `  { x: ${z.x}, y: ${z.y} },`
    ).join('\n');
    navigator.clipboard.writeText(`const TERRAIN_ZONES: TerrainZone[] = [\n${lines}\n];`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentGround = Math.round(getHeroGround(worldX, zones));

  return (
    <div style={{
      position: 'absolute', top: 80, right: 12, zIndex: 99,
      background: 'rgba(4,12,6,0.96)', border: '1px solid #40e0d0',
      padding: '10px 12px', fontFamily: 'monospace', fontSize: 10,
      color: '#40e0d0', minWidth: 210, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ color: '#88ff66', letterSpacing: 2, marginBottom: 2 }}>TERRAIN EDITOR</div>

      <div>worldX: <b style={{ color: '#fff' }}>{Math.round(worldX)}</b></div>
      <div>chão atual: <b style={{ color: '#c4de3c' }}>+{currentGround}px</b></div>

      <hr style={{ border: 'none', borderTop: '1px solid #1a3a1a', margin: '2px 0' }} />

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>altura:</span>
        <input value={height} onChange={e => setHeight(e.target.value)}
          style={{ width: 48, background: '#0d1f10', border: '1px solid #2a4a2e', color: '#fff', padding: '2px 4px', fontFamily: 'monospace', fontSize: 10 }} />
        <span>px</span>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>tipo:</span>
        <select value={type} onChange={e => setType(e.target.value as 'step' | 'ramp')}
          style={{ background: '#0d1f10', border: '1px solid #2a4a2e', color: '#40e0d0', fontFamily: 'monospace', fontSize: 10 }}>
          <option value="step">degrau</option>
          <option value="ramp">rampa</option>
        </select>
      </div>

      {type === 'ramp' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>rampa:</span>
          <input value={rampLen} onChange={e => setRampLen(e.target.value)}
            style={{ width: 48, background: '#0d1f10', border: '1px solid #2a4a2e', color: '#fff', padding: '2px 4px', fontFamily: 'monospace', fontSize: 10 }} />
          <span>px</span>
        </div>
      )}

      <button onClick={mark} style={{
        background: '#0d2a0d', border: '1px solid #40e0d0', color: '#88ff66',
        fontFamily: 'monospace', fontSize: 10, padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
      }}>
        📍 Marcar (x={Math.round(worldX)})
      </button>

      {zones.length > 0 && (
        <>
          <hr style={{ border: 'none', borderTop: '1px solid #1a3a1a', margin: '2px 0' }} />
          <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[...zones].sort((a, b) => a.x - b.x).map(z => (
              <div key={z.x} style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cfe8c0' }}>
                <span style={{ flex: 1 }}>x:{z.x} y:{z.y}{z.ramp ? ` r:${z.ramp}` : ''}</span>
                <button onClick={() => onRemove(z.x)} style={{ background: 'none', border: 'none', color: '#ff6060', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={copyCode} style={{
            background: copied ? '#0d3320' : '#0d1f10', border: '1px solid #40e0d0', color: copied ? '#88ff66' : '#40e0d0',
            fontFamily: 'monospace', fontSize: 10, padding: '5px 8px', cursor: 'pointer',
          }}>
            {copied ? '✓ Copiado!' : '📋 Copiar código'}
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Motor principal
// ─────────────────────────────────────────────────────────
export default function StoryGame({ onExit, onRestart, startBeat = 0, startBg, quiz }: { onExit: () => void; onRestart?: () => void; startBeat?: number; startBg?: SceneBg; quiz?: SharedQuiz | null }) {
  // com um quiz do professor, o roteiro usa as perguntas dele; senão, o padrão
  const beats = useMemo(() => buildBeats(quiz), [quiz]);
  const [beatIndex, setBeatIndex] = useState(startBeat);
  const [bg, setBg] = useState<SceneBg>(startBg ?? 'noite');
  const [worldX, setWorldX] = useState(0);
  const [terrainZones, setTerrainZones] = useState<TerrainZone[]>([]);
  const [fade, setFade] = useState<{ text?: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [frame, setFrame] = useState(0);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateFrame, setGateFrame] = useState(0); // 0=fechado 1=entreaberto 2=aberto
  const [facing, setFacing] = useState(1);
  const [landmarkAnchor, setLandmarkAnchor] = useState<number | null>(null);
  const [conscienciaDefeated, setConscienciaDefeated] = useState(false);
  // luz do corredor: liga após a fala "A luz fica mais intensa..." e permanece
  const [corredorLightOn, setCorredorLightOn] = useState(false);
  // 1-4 = frame de despertar ativo; null = já acordou, usa hero normal
  const [wakeUpFrame, setWakeUpFrame] = useState<number | null>(null);
  const [showRabbit, setShowRabbit] = useState(false);
  const [boulderState, setBoulderState] = useState<BoulderState>('idle');
  const [landmarkKind, setLandmarkKind] = useState<'gate' | 'estufa-ext' | 'trunk' | 'computer' | 'consciencia' | 'lab'>('gate');
  const [appleTreeAnchor, setAppleTreeAnchor] = useState<number | null>(null);
  const [trunkAnchor, setTrunkAnchor] = useState<number | null>(null);
  // âncora persistente da Consciência: o derrotado continua na cena depois
  // que o herói segue para o lab (landmarkKind muda para 'lab')
  const [conscienciaAnchor, setConscienciaAnchor] = useState<number | null>(null);
  const [sceneFade, setSceneFade] = useState(false);
  const [sceneFadeColor, setSceneFadeColor] = useState('#000');
  const [logsVisible, setLogsVisible] = useState(false);

  const beat: Beat | undefined = beats[beatIndex];
  const advance = useCallback(() => setBeatIndex(i => i + 1), []);

  // herói está perto o suficiente do portão/landmark para apertar OK.
  // No corredor a Consciência usa parallax 0.22, então a distância na tela é
  // (anchor - worldX*0.22); com limiar apertado o herói anda até bem perto dela.
  const nearby = landmarkAnchor != null && (
    bg === 'corredor' && landmarkKind === 'consciencia'
      ? (landmarkAnchor - worldX * 0.22) < 150
      : (landmarkAnchor - worldX) < 200
  );

  // reseta o portão só na mudança de cena (tratado no effect de beats automáticos)
  useEffect(() => { setGateOpen(false); }, [beatIndex]);

  // animação de abertura: fechado → entreaberto → aberto
  useEffect(() => {
    if (!gateOpen) return;
    playSfx('gate');
    const t1 = setTimeout(() => setGateFrame(1), 400);
    const t2 = setTimeout(() => setGateFrame(2), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [gateOpen]);

  // animação dos quadros do herói
  useEffect(() => {
    const id = setInterval(() => setFrame(f => f + 1), moving ? 180 : 700);
    return () => clearInterval(id);
  }, [moving]);

  // sequência de despertar: f1→5s, f2→0.6s, f3→0.6s, f4→0.6s, depois null
  useEffect(() => {
    if (wakeUpFrame === null) return;
    const delay = wakeUpFrame === 1 ? 5000 : 600;
    const id = setTimeout(() => {
      setWakeUpFrame(f => (f !== null && f < 4) ? f + 1 : null);
    }, delay);
    return () => clearTimeout(id);
  }, [wakeUpFrame]);

  // ativa o coelho quando a clareira começa; reseta a pedra (clareira e ato3)
  useEffect(() => {
    if (bg === 'clareira') { setShowRabbit(true); setBoulderState('idle'); }
    if (bg === 'ato3' || bg === 'estufa') setBoulderState('idle');
  }, [bg]);

  // pré-carrega os efeitos sonoros (só roda uma vez)
  useEffect(() => { preloadSfx(); }, []);

  // checkpoint automático: salva o início do ato atual (último beat 'scene'
  // alcançado). "CONTINUAR" na tela inicial retoma desse ponto.
  useEffect(() => {
    if (beatIndex >= beats.length) { clearSave(); return; }  // jornada completa
    let cp = 0;
    for (let i = 0; i <= beatIndex; i++) if (beats[i].t === 'scene') cp = i;
    if (cp > 0) saveCheckpoint(cp);
  }, [beatIndex, beats]);

  // animação da pedra: tremor → descida → desaparecimento
  const triggerBoulder = useCallback(() => {
    playSfx('gate');
    setBoulderState('shaking');
    setTimeout(() => setBoulderState('sinking'), 800);
    setTimeout(() => setBoulderState('gone'), 1800);
  }, []);

  // beats automáticos (cenário / fade)
  useEffect(() => {
    if (!beat) return;
    if (beat.t === 'scene') {
      setSceneFadeColor(beat.bg === 'corredor' ? '#fff' : '#000');
      setSceneFade(true);
      const t1 = setTimeout(() => {
        setBg(beat.bg);
        setWorldX(0); // cada cena recomeça com o mundo zerado (props ancorados em wx absoluto)
        if (beat.bg === 'floresta') setWakeUpFrame(1);
      }, 550);
      const t2 = setTimeout(() => { setSceneFade(false); advance(); }, 1200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    } else if (beat.t === 'fade') {
      setFade({ text: beat.text });
      const id = setTimeout(() => { setFade(null); advance(); }, 1700);
      return () => clearTimeout(id);
    }
  }, [beatIndex, beat, advance]);

  // ── caminhada ──
  const targetRef = useRef<number | null>(null);
  const holdRef = useRef(false);
  const rafRef = useRef<number | undefined>(undefined);
  const lastRef = useRef(0);
  const dirRef = useRef<1 | -1>(1);
  const walkStartXRef = useRef(0);

  useEffect(() => {
    if (beat?.t === 'walk') {
      walkStartXRef.current = worldX;
      const dist = bg === 'corredor' ? beat.dist * 2 : beat.dist;
      targetRef.current = worldX + dist;
      if (beat.landmark) {
        // No corredor cada landmark é renderizado com um fator de parallax
        // diferente (consciencia → 0.22, lab → 1.0). O anchor precisa fazer o
        // worldX acumulado se cancelar quando o herói chega ao alvo, senão o
        // landmark fica fora da tela (worldX acumula entre os atos).
        const anchor = bg === 'corredor'
          ? (beat.landmark === 'consciencia'
              ? (worldX + dist) * 0.22 + 130   // 130px à direita da linha do herói (34%)
              : worldX + dist - GATE_AHEAD)
          : worldX + dist - GATE_AHEAD;
        setLandmarkAnchor(anchor);
        setLandmarkKind(beat.landmark as 'gate' | 'estufa-ext' | 'trunk' | 'computer' | 'consciencia' | 'lab');
        // guarda posição da macieira para ela persistir depois do collect
        if (beat.landmark === 'gate' && bg === 'ato3') setAppleTreeAnchor(anchor);
        // guarda posição do tronco para persistir depois do walk
        if (beat.landmark === 'trunk') setTrunkAnchor(anchor);
        // guarda posição da Consciência para o derrotado persistir até o herói ir embora
        if (beat.landmark === 'consciencia') setConscienciaAnchor(anchor);
      }
      // sem landmark: mantém o portão visível (sai de cena naturalmente ao rolar)
    } else if (beat?.t === 'scene') {
      // nova cena: limpa portão e âncora
      targetRef.current = null;
      setLandmarkAnchor(null);
      setLandmarkKind('gate');
      setAppleTreeAnchor(null);
      setTrunkAnchor(null);
      setConscienciaAnchor(null);
      setGateFrame(0);
      setCorredorLightOn(false);
    } else {
      targetRef.current = null;
      // say / question / fade: portão permanece no mundo
    }
    // liga a luz do corredor a partir da fala "A luz fica mais intensa..."
    if (bg === 'corredor' && beat?.t === 'say' && beat.lines.some(l => l.includes('luz fica mais intensa'))) {
      setCorredorLightOn(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatIndex]);

  // chegou ao alvo sem landmark → avança automaticamente; com landmark → espera OK
  useEffect(() => {
    if (beat?.t === 'walk' && !beat.landmark && targetRef.current != null && worldX >= targetRef.current) {
      holdRef.current = false; setMoving(false);
      targetRef.current = null;
      advance();
    }
  }, [worldX, beat, advance]);

  const loop = useCallback((ts: number) => {
    const dt = lastRef.current ? (ts - lastRef.current) / 1000 : 0;
    lastRef.current = ts;
    if (holdRef.current) {
      setWorldX(x => {
        const dir = dirRef.current;
        const next = x + dir * WALK_SPEED * (bg === 'corredor' ? 3 : 1) * dt;
        if (dir === -1) return Math.max(next, walkStartXRef.current);
        if (targetRef.current != null) return Math.min(next, targetRef.current);
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    } else {
      rafRef.current = undefined; lastRef.current = 0;
    }
  }, []);

  const startWalkForward = useCallback(() => {
    if (beat?.t !== 'walk' || holdRef.current) return;
    dirRef.current = 1; setFacing(1);
    holdRef.current = true; setMoving(true); lastRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [beat, loop]);

  const startWalkBackward = useCallback(() => {
    if (beat?.t !== 'walk' || holdRef.current) return;
    dirRef.current = -1; setFacing(-1);
    holdRef.current = true; setMoving(true); lastRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [beat, loop]);

  const stopWalk = useCallback(() => {
    holdRef.current = false; setMoving(false);
  }, []);

  // teclado: segurar ← A / → D para andar
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'd') startWalkForward();
      if (e.key === 'ArrowLeft' || e.key === 'a') startWalkBackward();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'ArrowLeft' || e.key === 'a') stopWalk();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [startWalkForward, startWalkBackward, stopWalk]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const finished = beatIndex >= beats.length;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ touchAction: 'none', userSelect: 'none' }}
      onContextMenu={(e) => e.preventDefault()}>
      <ImagePreloader />
      {/* cobre o verde do body na faixa do FLOOR (abaixo do mundo) */}
      {bg !== 'pantano' && bg !== 'corredor' && <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOOR,
        backgroundImage: "url('/escape-assets/world/ground-dark.png')",
        backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
        backgroundPositionX: `${Math.round(-worldX)}px`,
        imageRendering: 'pixelated',
      }} />}
      {/* pantano — bg estendido até o rodapé (cobre o verde do body) */}
      {bg === 'pantano' && <img src="/escape-assets/pantano/bg.png" alt="" style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'center top',
        zIndex: 0, imageRendering: 'pixelated',
      }} />}
      {/* pantano — fundo do rodapé */}
      {bg === 'pantano' && <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOOR,
        background: '#96c37d', zIndex: 24,
      }} />}
      {bg === 'pantano' && <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: FLOOR,
        backgroundImage: "url('/escape-assets/pantano/dead-trees.png')",
        backgroundRepeat: 'repeat-x', backgroundSize: `auto ${FLOOR * 1.5}px`,
        backgroundPositionX: `${Math.round(-worldX * 0.70)}px`, backgroundPositionY: '-80px',
        imageRendering: 'pixelated', zIndex: 25,
      }} />}
      {/* pantano — plantas sobre o rodapé */}
      {bg === 'pantano' && [
        { src: 'pantano/plant-bush.png', wx: 50,   f: 0.80, h: 120, flip: false },
        { src: 'pantano/plant-tall.png', wx: 270,  f: 0.78, h: 150, flip: true  },
        { src: 'pantano/plant-bush.png', wx: 500,  f: 0.82, h: 110, flip: false },
        { src: 'pantano/plant-tall.png', wx: 750,  f: 0.79, h: 160, flip: true  },
        { src: 'pantano/plant-bush.png', wx: 1000, f: 0.81, h: 125, flip: false },
        { src: 'pantano/plant-tall.png', wx: 1300, f: 0.77, h: 145, flip: false },
        { src: 'pantano/plant-bush.png', wx: 1600, f: 0.80, h: 115, flip: true  },
      ].map((p, i) => {
        const sx = Math.round(p.wx - worldX * p.f);
        const vw = typeof window !== 'undefined' ? window.innerWidth : 900;
        if (sx > vw + 200 || sx < -200) return null;
        const swayDur = 2.5 + (i % 4) * 0.6;
        const swayDelay = -(i * 1.1 % swayDur);
        return (
          <div key={`rp${i}`} style={{ position: 'absolute', left: sx, bottom: FLOOR - 30, zIndex: 26, transform: p.flip ? 'scaleX(-1)' : undefined }}>
            <img src={`/escape-assets/${p.src}`} alt="" style={{
              height: p.h, width: 'auto', imageRendering: 'pixelated', display: 'block',
              transformOrigin: 'bottom center',
              animation: `plant-sway-strong ${swayDur}s ease-in-out ${swayDelay}s infinite`,
            }} />
          </div>
        );
      })}
      <ParallaxWorld bg={bg} worldX={worldX} gateOpen={gateOpen} gateFrame={gateFrame} landmarkAnchor={landmarkAnchor} nearby={nearby} boulderState={boulderState} landmarkKind={landmarkKind} appleTreeAnchor={appleTreeAnchor} trunkAnchor={trunkAnchor} conscienciaAnchor={conscienciaAnchor} computerOn={landmarkKind === 'computer' && beat?.t !== 'walk'} logsVisible={logsVisible} conscienciaDefeated={conscienciaDefeated} />

      {/* partículas ambientais por cena: folhas nas florestas, esporos no
          pântano, pólen dourado no final */}
      {(bg === 'floresta' || bg === 'clareira' || bg === 'ato3') && <SceneParticles kind="folhas" />}
      {bg === 'pantano' && <SceneParticles kind="pantano" />}
      {bg === 'final' && <SceneParticles kind="final" />}

      {(bg === 'floresta' || bg === 'clareira' || bg === 'ato3' || bg === 'estufa' || bg === 'pantano' || bg === 'corredor' || bg === 'final') && !finished && (
        wakeUpFrame !== null
          ? <WakeUpHero frame={wakeUpFrame} />
          : <Hero moving={moving} frame={frame} facing={facing} groundOffset={getHeroGround(worldX, bg === 'pantano' ? TERRAIN_ZONES : terrainZones) + (bg === 'final' ? 60 : 0)} />
      )}

      {/* Editor de terreno — só em DEV/test, durante walk beats */}
      {(import.meta.env.DEV || isTestMode) && beat?.t === 'walk' && (
        <TerrainEditorPanel
          worldX={worldX}
          zones={terrainZones}
          onAdd={z => setTerrainZones(prev => [...prev.filter(p => p.x !== z.x), z])}
          onRemove={x => setTerrainZones(prev => prev.filter(p => p.x !== x))}
        />
      )}

      {/* DEV: botão de atalho para o combate */}
      {(import.meta.env.DEV || isTestMode) && beat?.t !== 'battle' && (
        <button
          onClick={() => {
            const idx = beats.findIndex(b => b.t === 'battle');
            setWorldX(0); setBg('corredor'); setBeatIndex(idx);
            // posiciona a Consciência ao lado do herói para o derrotado aparecer após a luta
            setConscienciaAnchor(130); setLandmarkAnchor(130); setLandmarkKind('consciencia');
            setCorredorLightOn(true); // no jogo normal a luz já está acesa ao chegar no combate
          }}
          className="font-pixel"
          style={{
            position: 'absolute', bottom: 12, left: 12, zIndex: 50,
            fontSize: 8, color: '#ffe080', background: 'rgba(40,20,0,0.85)',
            border: '2px solid #c08010', padding: '8px 10px', cursor: 'pointer',
          }}
        >⚔ COMBATE</button>
      )}
      {/* DEV: botão de atalho para o laboratório final */}
      {(import.meta.env.DEV || isTestMode) && (
        <button
          onClick={() => {
            const idx = beats.findIndex(b => b.t === 'walk' && b.landmark === 'lab');
            setWorldX(0); setBg('corredor');
            setConscienciaDefeated(true); setCorredorLightOn(true);
            // âncora do derrotado para ele continuar na cena e recuar (como no jogo normal)
            setConscienciaAnchor(130);
            setBeatIndex(idx);
          }}
          className="font-pixel"
          style={{
            position: 'absolute', bottom: 12, left: 100, zIndex: 50,
            fontSize: 8, color: '#80ffcc', background: 'rgba(0,30,20,0.85)',
            border: '2px solid #10c080', padding: '8px 10px', cursor: 'pointer',
          }}
        >🏛 LAB</button>
      )}

      {/* coelho aparece 7s após a clareira começar, passa uma vez */}
      {showRabbit && !finished && <WalkingRabbit onDone={() => setShowRabbit(false)} />}

      {/* botão sair — top:48 para não sobrepor o PULAR da intro (top:14) */}
      <button onPointerDown={(e) => { e.preventDefault(); onExit(); }}
        onContextMenu={(e) => e.preventDefault()}
        className="font-pixel"
        style={{ position: 'absolute', top: 48, right: 12, zIndex: 50, fontSize: 8, color: '#cfe8c0', background: 'rgba(8,24,12,0.8)', border: '2px solid #2f6b34',  padding: '8px 10px', cursor: 'pointer', touchAction: 'none' }}>
        ✕ SAIR
      </button>

      {/* diálogo */}
      {beat?.t === 'say' && (
        <SayRunner key={beatIndex} beat={beat} onDone={advance} />
      )}

      {/* pergunta — só no ato1 (portão) */}
      {beat?.t === 'question' && (
        <QuestionBeat key={beatIndex} beat={beat} onSolved={advance}
          onCorrect={() => setGateOpen(true)} />
      )}

      {/* coleta de maçãs — ato3 */}
      {beat?.t === 'collect' && (
        <CollectBeat key={beatIndex} beat={beat} onSolved={advance}
          onCorrect={() => {}} />
      )}

      {/* pareamento — na clareira a pedra range e afunda; na floresta abre o portão */}
      {beat?.t === 'match' && (
        <MatchBeat key={beatIndex} beat={beat} onSolved={advance}
          onCorrect={bg === 'clareira' ? triggerBoulder : () => setGateOpen(true)} />
      )}

      {/* sequência — ato 5 (pântano): ordene o ciclo de vida */}
      {beat?.t === 'sequence' && (
        <SequenceBeat key={beatIndex} beat={beat} onSolved={() => { setLogsVisible(true); advance(); }} onCorrect={() => {}} />
      )}

      {/* combate — ato 6: Consciência Verde (estilo Pokémon GBA) */}
      {beat?.t === 'battle' && (
        <BattleBeat key={beatIndex} beat={beat} onSolved={() => { setConscienciaDefeated(true); advance(); }} onCorrect={() => {}} />
      )}

      {/* escolha — ato 7 (final): a decisão */}
      {beat?.t === 'choice' && (
        <ChoiceBeat key={beatIndex} beat={beat} onSolved={advance} />
      )}

      {/* lore — ilustração cinemática em tela cheia */}
      {beat?.t === 'lore' && (
        <LoreBeat key={beatIndex} beat={beat} onSolved={advance} />
      )}

      {/* outro — epílogo ilustrado com crossfade contínuo */}
      {beat?.t === 'outro' && (
        <EpilogueBeat key={beatIndex} beat={beat} onSolved={advance} />
      )}

      {/* D-pad de caminhada — lado esquerdo */}
      {beat?.t === 'walk' && (
        <div style={{ position: 'absolute', left: 30, bottom: FLOOR - 112, zIndex: 45, display: 'flex', gap: 10 }}>
          <button
            onPointerDown={(e) => { e.preventDefault(); startWalkBackward(); }} onPointerUp={stopWalk} onPointerLeave={stopWalk} onPointerCancel={stopWalk}
            onContextMenu={(e) => e.preventDefault()}
            className="btn-game"
            style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 4px 0 0 #2ca149, inset -4px 0 0 #c4de3c', cursor: 'pointer', touchAction: 'none', WebkitTouchCallout: 'none' } as CSSProperties}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <polygon points="22,4 10,16 22,28" fill="#0d2a0d"/>
              <polygon points="20,7 11,16 20,25" fill="#e8ffe0"/>
            </svg>
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); startWalkForward(); }} onPointerUp={stopWalk} onPointerLeave={stopWalk} onPointerCancel={stopWalk}
            onContextMenu={(e) => e.preventDefault()}
            className="btn-game"
            style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 4px 0 0 #2ca149, inset -4px 0 0 #c4de3c', cursor: 'pointer', touchAction: 'none', WebkitTouchCallout: 'none' } as CSSProperties}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <polygon points="10,4 22,16 10,28" fill="#0d2a0d"/>
              <polygon points="12,7 21,16 12,25" fill="#e8ffe0"/>
            </svg>
          </button>
        </div>
      )}
      {/* botão OK — lado direito, aparece ao chegar no marco (portão ou pedra) */}
      {beat?.t === 'walk' && nearby && (bg === 'clareira' ? boulderState === 'idle'
        : bg === 'ato3' ? boulderState === 'idle'
        : !gateOpen) && (
        <button onPointerDown={(e) => { e.preventDefault(); advance(); }} onContextMenu={(e) => e.preventDefault()}
          className="font-pixel"
          style={{ position: 'absolute', right: 5, bottom: FLOOR - 112, zIndex: 45, width: 72, height: 72, fontSize: 13, color: '#ffffff', textShadow: '2px 2px 0 rgba(0,0,0,0.55)', background: 'linear-gradient(to bottom, #b06010 0% 12.5%, #f0a010 12.5% 87.5%, #f0c840 87.5% 100%)', border: '4px solid #0d2a0d', boxShadow: 'inset 4px 0 0 #b06010, inset -4px 0 0 #f0c840, 0 6px 0 #0d2a0d', cursor: 'pointer', animation: 'hint-bob 0.9s ease-in-out infinite', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', WebkitTouchCallout: 'none' } as CSSProperties}>
          OK
        </button>
      )}
      {beat?.t === 'walk' && beat.hint && (
        <div className="font-pixel" style={{ position: 'absolute', left: '50%', top: '14%', transform: 'translateX(-50%)', zIndex: 45, color: '#eaf6e0', fontSize: 10, textShadow: '0 2px 4px #000', animation: 'hint-bob 1.4s ease-in-out infinite' }}>
          {beat.hint}
        </div>
      )}

      {/* fade */}
      {/* transição entre atos — escurece e clareia a tela */}
      {/* luz intensa vinda da direita — diálogo antes do corredor (pântano) */}
      {bg === 'pantano' && beat?.t === 'say' && beat.lines.some(l => l.includes('luz fica mais intensa')) && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 100% at 100% 50%, rgba(255,255,200,0.85) 0%, rgba(255,240,150,0.4) 40%, transparent 75%)',
          animation: 'right-light-pulse 2s ease-in-out infinite',
        }} />
      )}

      {/* luz suave em frente ao herói no corredor — surge após a fala
          "A luz fica mais intensa..." e permanece; zIndex 24 fica atrás
          da camada de chão/terra (foreground, zIndex 25). */}
      {bg === 'corredor' && corredorLightOn && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 24, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 30% 60% at 58% 56%, rgba(255,255,200,0.42) 0%, rgba(255,240,150,0.16) 45%, transparent 72%)',
          animation: 'right-light-pulse 2.6s ease-in-out infinite',
        }} />
      )}

      {sceneFade && <PixelTransition color={sceneFadeColor} />}

      {fade && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fade-hold 1.7s ease-in-out' }}>
          {fade.text && <p className="font-vt" style={{ color: '#cfe8c0', fontSize: 26, fontStyle: 'italic' }}>{fade.text}</p>}
        </div>
      )}

      {/* tela de resultados — fim da jornada */}
      {finished && <ResultsScreen onExit={onExit} onRestart={onRestart} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Tela de resultados — fim da jornada
// Medalha (pelos erros), estatísticas e o final escolhido.
// ─────────────────────────────────────────────────────────
const MEDAL_CFG = {
  ouro:   { title: 'MESTRE DO JARDIM',      ribbon: '#2f9410', metal: '#ffd54a', shine: '#fff0a0', dark: '#b8901a' },
  prata:  { title: 'GUARDIÃO DA FLORESTA',  ribbon: '#2f6b34', metal: '#cfd8e0', shine: '#f0f6fa', dark: '#8a98a4' },
  bronze: { title: 'EXPLORADOR BOTÂNICO',   ribbon: '#4a3a20', metal: '#cd8a4a', shine: '#eab080', dark: '#8a5a2a' },
} as const;

function MedalIcon({ medal, size = 84 }: { medal: keyof typeof MEDAL_CFG; size?: number }) {
  const c = MEDAL_CFG[medal];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges">
      {/* fitas */}
      <rect x="8" y="1" width="3" height="8" fill={c.ribbon} />
      <rect x="13" y="1" width="3" height="8" fill={c.ribbon} />
      <rect x="9" y="1" width="1" height="8" fill="#eaffe0" opacity="0.35" />
      <rect x="14" y="1" width="1" height="8" fill="#eaffe0" opacity="0.35" />
      {/* medalha */}
      <rect x="8" y="8" width="8" height="2" fill={c.dark} />
      <rect x="6" y="10" width="12" height="8" fill={c.dark} />
      <rect x="7" y="9" width="10" height="9" fill={c.metal} />
      <rect x="8" y="10" width="3" height="3" fill={c.shine} />
      {/* estrela central */}
      <rect x="11" y="11" width="2" height="6" fill={c.dark} />
      <rect x="9" y="13" width="6" height="2" fill={c.dark} />
    </svg>
  );
}

function ResultsScreen({ onExit, onRestart }: { onExit: () => void; onRestart?: () => void }) {
  const stats = useMemo(() => getStats(), []);
  const medal = medalFor(stats);
  const cfg = MEDAL_CFG[medal];
  const [step, setStep] = useState(0);   // revela os elementos em sequência

  useEffect(() => {
    const times = [300, 900, 1500, 2100];
    const ids = times.map((t, i) => setTimeout(() => {
      setStep(i + 1);
      if (i === 1) playChord([PENTA[0], PENTA[2], PENTA[4]], 1.8, 0.09);
      else playTone(PENTA[i % PENTA.length], 0.4, 'triangle', 0.1);
    }, t));
    return () => ids.forEach(clearTimeout);
  }, []);

  const reveal = (n: number): CSSProperties => ({
    opacity: step >= n ? 1 : 0,
    transform: step >= n ? 'translateY(0)' : 'translateY(10px)',
    transition: 'opacity .5s, transform .5s',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(3,10,5,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...WOOD_PANEL, padding: '26px 26px 22px', maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <p className="font-pixel" style={{ color: '#e8c088', fontSize: 12, letterSpacing: 2, ...reveal(1) }}>
          FIM DA JORNADA
        </p>

        {/* medalha + título */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...reveal(2) }}>
          <div style={{ filter: `drop-shadow(0 0 18px ${cfg.metal}88)`, animation: 'hint-bob 2.6s ease-in-out infinite' }}>
            <MedalIcon medal={medal} />
          </div>
          <p className="font-pixel" style={{ color: cfg.metal, fontSize: 10, textAlign: 'center' }}>{cfg.title}</p>
        </div>

        {/* estatísticas */}
        <div className="font-vt" style={{ width: '100%', color: '#eaf6e0', fontSize: 19, lineHeight: 1.7, borderTop: '2px solid #7a4f22', borderBottom: '2px solid #7a4f22', padding: '10px 4px', ...reveal(3) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Desafios superados</span><span style={{ color: '#88ff66' }}>{stats.solved}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Erros no caminho</span><span style={{ color: stats.errors === 0 ? '#88ff66' : '#ffb060' }}>{stats.errors}</span>
          </div>
          {stats.ending && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Sua escolha</span>
              <span style={{ color: stats.ending === 'luz' ? '#9dffb0' : '#d0a8c0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <PixelIcon kind={stats.ending === 'luz' ? 'sprout' : 'wilt'} size={16} />
                {stats.ending === 'luz' ? 'O Recomeço' : 'O Silêncio'}
              </span>
            </div>
          )}
        </div>

        <p className="font-vt" style={{ color: '#cfe8c0', fontSize: 17, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.4, ...reveal(3) }}>
          {stats.ending === 'sombra'
            ? 'Talvez algum dia, alguém escolha diferente...'
            : 'Toda escolha sobre a natureza é uma escolha sobre o nosso futuro.'}
        </p>

        {/* ações */}
        <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 4, ...reveal(4) }}>
          {onRestart && (
            <button onClick={onRestart} className="btn-game font-pixel"
              style={{ flex: 1, fontSize: 9, padding: '14px 8px' }}>
              JOGAR DE NOVO
            </button>
          )}
          <button onClick={onExit} className="font-pixel"
            style={{
              flex: 1, fontSize: 9, padding: '14px 8px', cursor: 'pointer',
              color: '#eaf6e0', background: 'rgba(30,70,38,0.9)', border: '2px solid #2f6b34',
            }}>
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Transição de cena em blocos pixel (estilo GBA)
// Grade 12×8; cada bloco cresce com um pequeno atraso em padrão
// diagonal, cobre a tela durante a troca do cenário (~550ms) e encolhe.
// Duração total = 1.2s, igual ao antigo fade (os timeouts do beat 'scene'
// continuam válidos).
// ─────────────────────────────────────────────────────────
function PixelTransition({ color }: { color: string }) {
  const COLS = 12, ROWS = 8;
  const cells = useMemo(() => Array.from({ length: COLS * ROWS }, (_, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    return ((col + row) % 5) * 0.045 + ((col * 7 + row * 3) % 3) * 0.02;
  }), []);
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 58, pointerEvents: 'none',
      display: 'grid',
      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
      gridTemplateRows: `repeat(${ROWS}, 1fr)`,
    }}>
      {cells.map((delay, i) => (
        <div key={i} style={{
          background: color,
          animation: `block-in-out 0.95s steps(5) ${delay}s both`,
        }} />
      ))}
    </div>
  );
}

// roda as linhas de um beat 'say' uma a uma
function SayRunner({ beat, onDone }: { beat: Extract<Beat, { t: 'say' }>; onDone: () => void }) {
  const [i, setI] = useState(0);
  const line = beat.lines[i] ?? '';
  const last = i >= beat.lines.length - 1;
  return (
    <DialogueBox who={beat.who} text={line} last={last}
      onNext={() => { if (last) onDone(); else setI(n => n + 1); }} />
  );
}
