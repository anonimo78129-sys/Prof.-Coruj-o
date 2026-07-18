import { useEffect, useRef, useState } from 'react';
import { preloadImages } from '../../game/preloadImages';

// Tempo mínimo em tela para o carregamento não "piscar" quando as imagens
// já estão em cache (evita um flash desconfortável).
const MIN_MS = 900;

export default function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const start = Date.now();
    let raf = 0;

    // progresso real das imagens (0..1)
    let target = 0;
    // progresso exibido, que persegue o alvo suavemente
    let shown = 0;

    const tick = () => {
      shown += (target - shown) * 0.18;
      setPct(Math.min(100, Math.round(shown * 100)));
      if (!doneRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const wait = Math.max(0, MIN_MS - (Date.now() - start));
      window.setTimeout(() => {
        doneRef.current = true;
        cancelAnimationFrame(raf);
        setPct(100);
        onDone();
      }, wait);
    };

    preloadImages((loaded, total) => {
      target = total ? loaded / total : 1;
    }).then(finish);

    return () => { doneRef.current = true; cancelAnimationFrame(raf); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      touchAction: 'none', userSelect: 'none',
    }}>
      {/* fundo — mesma floresta da tela inicial */}
      <img src="/escape-assets/landing-forest.png" alt="" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'center top', pointerEvents: 'none',
        animation: 'bg-breathe 7s ease-in-out infinite',
      }} />
      {/* escurecimento para legibilidade */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(4,14,7,0.62)' }} />

      {/* conteúdo central */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, padding: '0 32px', width: '100%', maxWidth: 420 }}>
        {/* coruja girando/pulsando — mascote do jogo */}
        <img src="/escape-assets/portraits/owl.png" alt="" style={{
          width: 76, height: 76, imageRendering: 'pixelated',
          filter: 'drop-shadow(0 0 12px rgba(64,224,208,0.6))',
          animation: 'logo-float 2.4s ease-in-out infinite',
        }} />

        <p className="font-pixel" style={{
          color: '#eaf6e0', fontSize: 13, letterSpacing: 2, textAlign: 'center',
          textShadow: '0 2px 8px rgba(0,0,0,0.9)',
        }}>
          CARREGANDO
        </p>

        {/* barra de progresso — moldura de madeira pixel */}
        <div style={{
          width: '100%',
          background: '#1a0e06',
          border: '4px solid #8b5e2e',
          boxShadow: 'inset 0 0 0 2px #c4874c, inset 0 0 0 4px #7a4f22, 0 0 0 2px #3a1f08',
          imageRendering: 'pixelated',
          padding: 5,
        }}>
          <div style={{
            height: 20,
            width: `${pct}%`,
            background: 'linear-gradient(to bottom, #7be04a 0%, #3fae2a 55%, #2f7e1c 100%)',
            boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.35)',
            transition: 'width 0.12s linear',
          }} />
        </div>

        <p className="font-pixel" style={{ color: '#9fd89a', fontSize: 10, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
          {pct}%
        </p>

        <p className="font-vt" style={{ color: '#cfe8c8', fontSize: 18, textAlign: 'center', opacity: 0.85, marginTop: -6 }}>
          Preparando o jardim...
        </p>
      </div>
    </div>
  );
}
