import { useCallback, useEffect, useState } from 'react';
import { playSfx } from '../../game/audio';

type CueType = 'narrador' | 'protagonista' | 'voz' | 'evento';
interface Cue { type: CueType; text: string; }
interface Slide {
  frames: string[];
  frameForCue?: number[];  // frame index per cue; if absent, stays on frame 0
  cues: Cue[];
  autoDuration?: number;   // ms — for slides with no cues, auto-advance
}

const CUE_CFG: Record<CueType, {
  label: string | null;
  color: string;
  italic: boolean;
  center: boolean;
  portrait: string | null;
}> = {
  narrador:     { label: null,              color: '#eaf6e0', italic: true,  center: false, portrait: null },
  protagonista: { label: 'Você',            color: '#eaf6e0', italic: false, center: false, portrait: '/escape-assets/portraits/hero.png' },
  voz:          { label: 'Voz Misteriosa',  color: '#40e0d0', italic: true,  center: false, portrait: null },
  evento:       { label: null,              color: '#c8dce8', italic: true,  center: true,  portrait: null },
};

// Typewriter speed (ms per char)
const SPEED: Record<CueType, number> = { narrador: 28, protagonista: 28, voz: 55, evento: 32 };

const SLIDES: Slide[] = [
  // 01 — Parada de ônibus (4 frames: geral → espera cansada)
  {
    frames: [
      '/escape-assets/intro/parada-1.png',
      '/escape-assets/intro/parada-2.png',
      '/escape-assets/intro/parada-3.png',
      '/escape-assets/intro/parada-4.png',
    ],
    frameForCue: [0, 1, 2, 3],
    cues: [
      { type: 'narrador',     text: 'O dia foi longo.' },
      { type: 'narrador',     text: 'Semanas de provas e trabalhos drenaram quase toda a sua energia.' },
      { type: 'protagonista', text: 'Faltam só 3 dias para a prova final... e eu mal dormi essa semana.' },
      { type: 'protagonista', text: 'Preciso revisar tudo quando chegar em casa.' },
    ],
  },
  // 02 — O ônibus chega e o protagonista embarca (2 frames)
  {
    frames: [
      '/escape-assets/intro/parada-5.png',
      '/escape-assets/intro/parada-6.jpg',
    ],
    frameForCue: [0, 0, 1],
    cues: [
      { type: 'evento', text: 'Um ônibus se aproxima do ponto.' },
      { type: 'evento', text: 'As portas se abrem.' },
      { type: 'evento', text: 'Você embarca.' },
    ],
  },
  // 03 — Dentro do ônibus (4 frames: em pé → sentado → sonolento → dormindo)
  {
    frames: [
      '/escape-assets/intro/onibus-1.png',
      '/escape-assets/intro/onibus-2.png',
      '/escape-assets/intro/onibus-3.png',
      '/escape-assets/intro/onibus-4.png',
    ],
    frameForCue: [0, 1, 2, 3],
    cues: [
      { type: 'narrador',     text: 'O ônibus segue pela avenida. Você encontra um lugar.' },
      { type: 'narrador',     text: 'O balanço constante torna cada vez mais difícil manter os olhos abertos.' },
      { type: 'protagonista', text: 'Talvez eu possa descansar só um pouco...' },
      { type: 'protagonista', text: 'Só um cochilo rápido...' },
    ],
  },
  // 04 — Caindo pelo céu (transição do sonho + voz misteriosa)
  {
    frames: ['/escape-assets/intro/caindo-1.png'],
    cues: [
      { type: 'evento', text: 'O som do motor se dissolve no silêncio.' },
      { type: 'evento', text: 'O chão desaparece, e você cai por um céu sem fim.' },
      { type: 'voz',    text: 'Acorde, jovem.' },
      { type: 'voz',    text: 'Plante o seu amanhã...' },
    ],
  },
  // 05 — Acordando na floresta encantada (4 frames: caído → apoiando → de quatro → em pé)
  {
    frames: [
      '/escape-assets/intro/acordando-1.png',
      '/escape-assets/intro/acordando-2.png',
      '/escape-assets/intro/acordando-3.png',
      '/escape-assets/intro/acordando-4.png',
    ],
    frameForCue: [0, 1, 2, 3, 3, 3],
    cues: [
      { type: 'narrador',     text: 'Você abre os olhos lentamente.' },
      { type: 'narrador',     text: 'O assento do ônibus... desapareceu.' },
      { type: 'protagonista', text: 'Onde... onde eu estou?' },
      { type: 'narrador',     text: 'Um imenso jardim selvagem se ergue ao seu redor: uma floresta encantada, viva e brilhante.' },
      { type: 'protagonista', text: 'Eu estava no ônibus... Como vim parar aqui?' },
      { type: 'protagonista', text: 'Estou sonhando?' },
    ],
  },
];

// Todos os frames únicos, empilhados como camadas para o crossfade suave.
const ALL_FRAMES = [...new Set(SLIDES.flatMap(s => s.frames))];

export default function IntroSequence({ onDone }: { onDone: () => void }) {
  const [slideIdx, setSlideIdx]   = useState(0);
  const [cueIdx,   setCueIdx]     = useState(0);
  const [shown,    setShown]      = useState('');
  const [typeDone, setTypeDone]   = useState(false);
  const [opacity,  setOpacity]    = useState(1);

  const slide    = SLIDES[slideIdx];
  const cue      = slide.cues[cueIdx] ?? null;
  const frameIdx = slide.frameForCue ? (slide.frameForCue[cueIdx] ?? 0) : 0;
  const frameSrc = slide.frames[Math.min(frameIdx, slide.frames.length - 1)];

  // habilita o crossfade só após montar (para o 1º frame entrar suave, não instantâneo)
  const [vis, setVis] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVis(true), 40); return () => clearTimeout(t); }, []);

  // Typewriter
  useEffect(() => {
    if (!cue) return;
    setShown(''); setTypeDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(cue.text.slice(0, i));
      if (i >= cue.text.length) { clearInterval(id); setTypeDone(true); }
    }, SPEED[cue.type]);
    return () => clearInterval(id);
  }, [cue]);

  const goNextSlide = useCallback(() => {
    const next = slideIdx + 1;
    if (next >= SLIDES.length) { onDone(); return; }
    // só o texto/gradiente some rápido; a IMAGEM faz crossfade contínuo
    // para o frame do próximo slide (sem passar pelo preto)
    setOpacity(0);
    setTimeout(() => {
      setSlideIdx(next);
      setCueIdx(0);
      setTimeout(() => setOpacity(1), 40);
    }, 380);
  }, [slideIdx, onDone]);

  // Auto-advance for slides without cues
  useEffect(() => {
    if (slide.cues.length > 0) return;
    const id = setTimeout(goNextSlide, slide.autoDuration ?? 2500);
    return () => clearTimeout(id);
  }, [slideIdx, slide, goNextSlide]);

  // Fade in on mount
  useEffect(() => { setOpacity(0); setTimeout(() => setOpacity(1), 30); }, []);

  const advance = useCallback(() => {
    if (!cue) return;
    if (!typeDone) { setShown(cue.text); setTypeDone(true); return; }
    const next = cueIdx + 1;
    if (next < slide.cues.length) { setCueIdx(next); return; }
    goNextSlide();
  }, [cue, typeDone, cueIdx, slide, goNextSlide]);

  const cfg = cue ? CUE_CFG[cue.type] : null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000', cursor: 'pointer', touchAction: 'none', userSelect: 'none' }}
      onPointerDown={(e) => { e.preventDefault(); if (slide.cues.length > 0) { playSfx('tap'); advance(); } }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ilustração — camadas empilhadas: só a ativa fica visível e a troca
          é um crossfade suave de 0.9s (imagem → imagem, sem passar pelo preto) */}
      {ALL_FRAMES.map(f => (
        <div key={f} style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url('${f}')`,
          backgroundSize: 'cover', backgroundPosition: 'center top',
          imageRendering: 'pixelated',
          opacity: (vis && f === frameSrc) ? 1 : 0,
          transition: 'opacity 0.9s ease',
        }} />
      ))}

      {/* gradiente embaixo para legibilidade do texto */}
      {cue && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: cue.type === 'evento' ? '35%' : '55%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.45) 50%, transparent 100%)',
          pointerEvents: 'none',
          opacity, transition: 'opacity 0.38s ease',
        }} />
      )}

      {/* caixa de diálogo — dois estilos: normal (moldura pixel) e evento (legenda) */}
      {cue && cfg && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: `0 16px ${cue.type === 'evento' ? 48 : 36}px`,
          opacity, transition: 'opacity 0.38s ease',
        }}>
          {cue.type === 'evento' ? (
            /* Legenda cinemática — sem moldura, centralizada */
            <p className="font-vt" style={{
              color: cfg.color,
              fontSize: 20,
              lineHeight: 1.4,
              fontStyle: 'italic',
              textAlign: 'center',
              textShadow: '0 2px 12px rgba(0,0,0,0.95)',
              letterSpacing: '0.04em',
            }}>
              {shown}
            </p>
          ) : (
            /* Moldura pixel art estilo madeira — igual ao jogo principal */
            <div style={{
              margin: '0 auto', maxWidth: 760,
              padding: '14px 18px',
              background: '#1a0e06',
              border: '4px solid #8b5e2e',
              boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
              position: 'relative',
            }}>
              {/* portrait do protagonista */}
              {cfg.portrait && (
                <div style={{
                  position: 'absolute', top: -60, left: 8,
                  width: 68, height: 68,
                  background: '#1a0e06',
                  border: '3px solid #8b5e2e',
                  boxShadow: 'inset 0 0 0 1px #c4874c, 0 0 0 1px #3a1f08',
                  imageRendering: 'pixelated',
                }}>
                  <img
                    src={cfg.portrait}
                    alt=""
                    style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
                  />
                </div>
              )}
              {/* label do personagem */}
              {cfg.label && (
                <p className="font-pixel" style={{
                  color: cue.type === 'voz' ? '#40e0d0' : '#88ff66',
                  fontSize: 9, marginBottom: 8,
                  textShadow: cue.type === 'voz' ? '0 0 10px rgba(64,224,208,0.8)' : 'none',
                }}>
                  {cfg.label}
                </p>
              )}
              {/* texto com typewriter */}
              <p className="font-vt" style={{
                color: cfg.color,
                fontSize: 22,
                lineHeight: 1.35,
                fontStyle: cfg.italic ? 'italic' : 'normal',
                minHeight: 30,
                textShadow: cue.type === 'voz'
                  ? '0 0 14px rgba(64,224,208,0.9), 0 0 28px rgba(64,224,208,0.5)'
                  : 'none',
              }}>
                {shown}
              </p>
              {typeDone && (
                <p className="font-pixel" style={{ color: '#7fae7a', fontSize: 8, textAlign: 'right', marginTop: 6 }}>
                  ▶ toque
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* botão pular */}
      <button
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setTimeout(onDone, 100); }}
        onContextMenu={(e) => e.preventDefault()}
        className="font-pixel"
        style={{
          position: 'absolute', top: 14, right: 14, zIndex: 10,
          fontSize: 7, color: 'rgba(200,220,200,0.6)', background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(200,220,200,0.25)', borderRadius: 4,
          padding: '6px 10px', cursor: 'pointer', touchAction: 'none',
        }}>
        PULAR
      </button>
    </div>
  );
}
