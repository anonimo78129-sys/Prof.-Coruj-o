import type { CSSProperties } from 'react';
import type { LoreFxKind } from '../../game/types';

// ─────────────────────────────────────────────────────────
// LoreFx — camadas de animação ambiental sobre as ilustrações de lore.
// Todas as primitivas reutilizam keyframes já existentes no index.css
// (firefly-*, mote-float, leaf-fall, beam-pulse, breathe-glow, screen-shimmer,
//  butterfly-*, light-pulse-dark) + lore-ripple / mist-drift.
// Tudo é pointer-events: none — o toque continua fechando o cartão.
// ─────────────────────────────────────────────────────────

// pseudo-random determinístico (mesmo padrão usado no resto do jogo)
const s = (n: number) => { const x = Math.sin(n + 1) * 10000; return x - Math.floor(x); };

const LAYER: CSSProperties = {
  position: 'absolute', inset: 0,
  pointerEvents: 'none', overflow: 'hidden',
};

// ── Vaga-lumes com deriva errante e pulso ──
export function FxFireflies({ count = 10, tint = 'cyan', seed = 0 }: {
  count?: number; tint?: 'cyan' | 'green'; seed?: number;
}) {
  const cfg = tint === 'cyan'
    ? { core: '#e0fffa', glow: '64,224,208' }
    : { core: '#eaffd0', glow: '150,255,120' };
  return (
    <div style={LAYER}>
      {Array.from({ length: count }, (_, i) => {
        const n = i * 3 + seed;
        const size = 2 + s(n * 3) * 3;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${s(n * 7) * 100}%`,
            top: `${8 + s(n * 13) * 80}%`,
            width: size, height: size, borderRadius: '50%',
            background: `radial-gradient(circle, ${cfg.core}, rgb(${cfg.glow}))`,
            boxShadow: `0 0 ${Math.round(size * 3)}px rgba(${cfg.glow},0.9), 0 0 ${Math.round(size * 7)}px rgba(${cfg.glow},0.5)`,
            ['--dx' as string]: `${(s(n * 19) > 0.5 ? 1 : -1) * (14 + s(n * 23) * 40)}px`,
            ['--dy' as string]: `${(s(n * 31) > 0.5 ? 1 : -1) * (8 + s(n * 37) * 26)}px`,
            animation: `firefly-drift ${8 + s(n * 5) * 10}s ease-in-out ${-s(n * 11) * 9}s infinite, ` +
                       `firefly-pulse ${1.3 + s(n * 41) * 2.2}s ease-in-out ${-s(n * 17) * 3}s infinite`,
          } as CSSProperties} />
        );
      })}
    </div>
  );
}

// ── Motes/pólen subindo lentamente ──
const MOTE_PALETTES = {
  gold:  { grad: 'radial-gradient(circle,#fff6d0,#ffcf57)', glow: 'rgba(255,200,80,0.7)' },
  green: { grad: 'radial-gradient(circle,#d4ffb0,#7ac850)', glow: 'rgba(150,255,120,0.6)' },
  petal: { grad: 'radial-gradient(circle,#fff0f6,#ffb0d0)', glow: 'rgba(255,170,210,0.7)' },
} as const;

export function FxMotes({ count = 10, palette = 'gold', seed = 0 }: {
  count?: number; palette?: keyof typeof MOTE_PALETTES; seed?: number;
}) {
  const cfg = MOTE_PALETTES[palette];
  return (
    <div style={LAYER}>
      {Array.from({ length: count }, (_, i) => {
        const n = i * 5 + seed;
        const size = 2 + s(n * 3) * 4;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${s(n * 7) * 100}%`,
            bottom: `${s(n * 23) * 60}%`,
            width: size, height: size, borderRadius: '50%',
            background: cfg.grad, boxShadow: `0 0 8px ${cfg.glow}`,
            ['--mx' as string]: `${(s(n * 13) > 0.5 ? 1 : -1) * (15 + s(n * 19) * 40)}px`,
            animation: `mote-float ${7 + s(n * 11) * 7}s ease-in-out ${-s(n * 17) * 9}s infinite`,
          } as CSSProperties} />
        );
      })}
    </div>
  );
}

// ── Folhas pixel caindo (macieira) ──
const LEAF_FX_COLORS = ['#4fae35', '#6fd04a', '#8fbc3a', '#c4453a', '#3a8a4a'];

export function FxLeaves({ count = 9, seed = 0 }: { count?: number; seed?: number }) {
  return (
    <div style={LAYER}>
      {Array.from({ length: count }, (_, i) => {
        const n = i * 7 + seed;
        const size = 3 + Math.round(s(n * 3) * 3);
        const dur = 9 + s(n * 11) * 8;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: `${s(n * 7) * 100}%`, top: 0,
            width: size, height: size,
            background: LEAF_FX_COLORS[i % LEAF_FX_COLORS.length],
            animation: `leaf-fall ${dur}s linear ${-s(n * 17) * dur}s infinite`,
            ['--lx' as string]: `${(s(n * 13) > 0.5 ? 1 : -1) * (30 + s(n * 19) * 90)}px`,
            ['--lr' as string]: `${180 + Math.round(s(n * 23) * 400)}deg`,
          } as CSSProperties} />
        );
      })}
    </div>
  );
}

// ── Raios de luz verticais pulsando ──
export function FxRays({ rays }: {
  rays?: Array<{ left: string; width: number; dur: number; delay: number }>;
}) {
  const list = rays ?? [
    { left: '16%', width: 54, dur: 5.5, delay: 0 },
    { left: '40%', width: 90, dur: 7.2, delay: 1.4 },
    { left: '66%', width: 46, dur: 6.1, delay: 2.3 },
  ];
  return (
    <div style={LAYER}>
      {list.map((r, i) => (
        <div key={i} style={{
          position: 'absolute', top: '-4%', bottom: '28%', left: r.left, width: r.width,
          transform: 'skewX(-10deg)',
          background: 'linear-gradient(to bottom, rgba(255,246,200,0.55), rgba(255,246,200,0))',
          animation: `beam-pulse ${r.dur}s ease-in-out ${r.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Brilho pulsante posicionado (cristal, cogumelos, brasa) ──
export function FxGlow({ left, top, size = 120, rgb = '64,224,208', dur = 2.6, maxOpacity = 0.55 }: {
  left: string; top: string; size?: number; rgb?: string; dur?: number; maxOpacity?: number;
}) {
  return (
    <div style={{
      position: 'absolute', left, top,
      width: size, height: size, borderRadius: '50%',
      background: `radial-gradient(circle, rgba(${rgb},${maxOpacity}), rgba(${rgb},0) 70%)`,
      transform: 'translate(-50%,-50%)',
      animation: `breathe-glow ${dur}s ease-in-out infinite`,
      pointerEvents: 'none',
    }} />
  );
}

// ── Ondulações concêntricas na água (vitória-régia do pântano) ──
export function FxRipples({ left, top }: { left: string; top: string }) {
  return (
    <div style={LAYER}>
      {[0, 1.3, 2.6].map((delay, i) => (
        <div key={i} style={{
          position: 'absolute', left, top,
          width: 110, height: 38, borderRadius: '50%',
          border: '2px solid rgba(220,255,230,0.65)',
          transform: 'translate(-50%,-50%)',
          animation: `lore-ripple 3.9s ease-out ${delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Faixas de névoa deslizando ──
export function FxMist({ bands }: { bands?: Array<{ top: string; height: string; dur: number; opacity: number }> }) {
  const list = bands ?? [
    { top: '34%', height: '14%', dur: 16, opacity: 0.30 },
    { top: '52%', height: '18%', dur: 22, opacity: 0.22 },
  ];
  return (
    <div style={LAYER}>
      {list.map((b, i) => (
        <div key={i} style={{
          position: 'absolute', left: '-15%', right: '-15%',
          top: b.top, height: b.height,
          background: `linear-gradient(to right, transparent, rgba(224,240,224,${b.opacity}), transparent)`,
          filter: 'blur(6px)',
          animation: `mist-drift ${b.dur}s ease-in-out ${i * -7}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Brilho varrendo o vidro (estufa/domo) ──
export function FxShimmer({ opacity = 0.6 }: { opacity?: number }) {
  return (
    <div style={{ ...LAYER, opacity }}>
      <div className="screen-shimmer" />
    </div>
  );
}

// ── Borboletas voando (sprites do corredor) ──
export function FxButterflies({ count = 4, seed = 0 }: { count?: number; seed?: number }) {
  const flies = Array.from({ length: count }, (_, i) => {
    const n = i * 9 + seed;
    return {
      blue: i % 2 === 1,
      rev: i % 3 === 2,
      delay: s(n * 7) * 20,
      dur: 16 + s(n * 3) * 14,
      bob: ['butterfly-bob-a', 'butterfly-bob-b', 'butterfly-bob-c', 'butterfly-bob-d'][i % 4],
      bobDur: 1.2 + s(n * 11) * 0.9,
      y: 12 + s(n * 13) * 55,
      size: 14 + s(n * 17) * 9,
    };
  });
  return (
    <div style={LAYER}>
      {flies.map((b, i) => {
        const prefix = b.blue ? 'blue-' : '';
        return (
          <div key={i} style={{
            position: 'absolute', left: -40, top: `${b.y}%`,
            width: b.size, height: b.size,
            animation: `${b.rev ? 'butterfly-move-x-rev' : 'butterfly-move-x'} ${b.dur}s linear ${-b.delay}s infinite`,
          }}>
            <div style={{ position: 'absolute', inset: 0, animation: `${b.bob} ${b.bobDur}s ease-in-out infinite` }}>
              <img src={`/escape-assets/corredor/butterfly-${prefix}1.png`} alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                  animation: 'butterfly-frame 0.22s steps(1) infinite' }} />
              <img src={`/escape-assets/corredor/butterfly-${prefix}2.png`} alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated',
                  animation: 'butterfly-frame2 0.22s steps(1) infinite' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vinheta suave pulsando (foca o olhar no centro) ──
export function FxVignette() {
  return (
    <div style={{
      ...LAYER,
      background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.35) 100%)',
      animation: 'light-pulse-dark 6s ease-in-out infinite',
    }} />
  );
}

// ─────────────────────────────────────────────────────────
// Composições por ilustração
// ─────────────────────────────────────────────────────────
export default function LoreFx({ kind }: { kind: LoreFxKind }) {
  switch (kind) {
    case 'portao': // cogumelos azuis dos dois lados + vaga-lumes
      return (<>
        <FxGlow left="9%"  top="58%" size={130} rgb="64,200,255" dur={3.2} maxOpacity={0.4} />
        <FxGlow left="90%" top="50%" size={150} rgb="64,200,255" dur={2.6} maxOpacity={0.4} />
        <FxFireflies count={12} />
        <FxVignette />
      </>);
    case 'clareira': // raios de luz na mata + bioluminescência
      return (<>
        <FxRays />
        <FxFireflies count={10} seed={40} />
        <FxVignette />
      </>);
    case 'macieira': // folhas caindo + pólen dourado
      return (<>
        <FxLeaves count={9} />
        <FxMotes count={6} palette="gold" seed={12} />
      </>);
    case 'estufa': // reflexo varrendo o vidro + motes
      return (<>
        <FxShimmer />
        <FxMotes count={8} palette="gold" seed={5} />
      </>);
    case 'pantano': // névoa + ondulação em volta da vitória-régia + vaga-lumes verdes
      return (<>
        <FxMist />
        <FxRipples left="50%" top="64%" />
        <FxFireflies count={9} tint="green" seed={21} />
      </>);
    case 'corredor': // borboletas + pólen dourado do entardecer
      return (<>
        <FxButterflies count={4} />
        <FxMotes count={10} palette="gold" seed={9} />
      </>);
    case 'consciencia': // cristal no peito pulsando + esporos
      return (<>
        <FxGlow left="51%" top="53%" size={170} rgb="64,224,208" dur={1.8} maxOpacity={0.55} />
        <FxMotes count={9} palette="green" seed={30} />
        <FxVignette />
      </>);
    case 'domo': // borboletas + brilho no vidro
      return (<>
        <FxButterflies count={3} seed={14} />
        <FxShimmer opacity={0.45} />
        <FxMotes count={6} palette="gold" seed={18} />
      </>);
    case 'semente': // feixe central de luz + pólen subindo + halo na copa
      return (<>
        <FxRays rays={[{ left: '36%', width: 120, dur: 4.6, delay: 0 }]} />
        <FxGlow left="50%" top="36%" size={210} rgb="255,230,150" dur={3.4} maxOpacity={0.32} />
        <FxMotes count={12} palette="gold" seed={2} />
      </>);
  }
}
