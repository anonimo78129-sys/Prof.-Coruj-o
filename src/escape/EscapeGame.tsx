// ─────────────────────────────────────────────────────────
// Mundo Perdido — jogo Escape (aventura narrativa) dentro do
// Prof. Corujão. Adaptado do app "Prof": a tela inicial, intro,
// jogo, criador de quiz do professor, créditos e preview de
// cenários viraram um overlay em tela cheia aberto pela aba Jogos.
// ─────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import type { GameConfig } from './types/game';
import type { SceneBg } from './game/types';
import SetupWizard from './components/TeacherSetup/SetupWizard';
import StoryGame from './components/Game/StoryGame';
import IntroSequence from './components/Game/IntroSequence';
import LoadingScreen from './components/Game/LoadingScreen';
import ScenePreview from './components/ScenePreview';
import Credits from './components/Game/Credits';
import { getSave, clearSave, resetStats } from './game/progress';
import { startMusic, stopMusic, startHomeTheme, stopHomeTheme } from './game/music';
import { decodeQuiz, type SharedQuiz } from './game/quizShare';
import './escape.css';

// Índices sincronizados com src/escape/game/script.ts (incluem os beats de lore)
const DEV_ACTS = [
  { label: 'Ato 1 — Floresta (portão)',       beat: 0,  bg: undefined            },
  { label: 'Ato 2 — Clareira (pedra)',         beat: 9,  bg: undefined            },
  { label: 'Ato 3 — Macieira (scene)',         beat: 17, bg: undefined            },
  { label: 'Ato 3 — Coleta de maçãs',         beat: 22, bg: 'ato3' as SceneBg   },
  { label: 'Ato 4 — Estufa (avistando)',       beat: 25, bg: 'ato3' as SceneBg   },
  { label: 'Ato 4 — Estufa (dentro)',          beat: 28, bg: undefined           },
  { label: 'Ato 4 — Computador',               beat: 31, bg: 'estufa' as SceneBg },
  { label: 'Ato 4 — Pergunta (Transpiração)',  beat: 33, bg: 'estufa' as SceneBg },
  { label: 'Ato 5 — Pântano (sequência)',      beat: 40, bg: 'pantano' as SceneBg },
  { label: 'Ato 6 — Corredor (luz)',           beat: 50, bg: 'corredor' as SceneBg },
  { label: 'Ato 7 — Final (a escolha)',        beat: 64, bg: 'final' as SceneBg },
] as const;

function seeded(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// Vaga-lumes turquesa fluorescentes: tamanhos 1–5 px, movimento errante orgânico
function Fireflies() {
  const flies = useMemo(() => Array.from({ length: 38 }, (_, i) => {
    const size = 1 + seeded(i * 3) * 4;          // 1–5 px
    const bright = 0.7 + seeded(i * 29) * 0.3;   // brilho variado
    return {
      id: i,
      left:     `${seeded(i * 7) * 100}%`,
      top:      `${seeded(i * 13) * 85}%`,        // não vai no rodapé dos botões
      size,
      // pulsar suave: alterna opacidade
      pulseDur: `${1.4 + seeded(i * 41) * 2.6}s`,
      pulseDelay: `-${seeded(i * 17) * 3}s`,
      // deriva pelo espaço
      driftDur:  `${9 + seeded(i * 5) * 14}s`,
      driftDelay: `-${seeded(i * 11) * 12}s`,
      driftX:    `${(seeded(i * 19) > 0.5 ? 1 : -1) * (18 + seeded(i * 23) * 55)}px`,
      driftY:    `${(seeded(i * 31) > 0.5 ? 1 : -1) * (10 + seeded(i * 37) * 35)}px`,
      glow: `0 0 ${Math.round(size * 2)}px rgba(64,224,208,${(bright * 0.9).toFixed(2)}), 0 0 ${Math.round(size * 5)}px rgba(64,224,208,${(bright * 0.55).toFixed(2)}), 0 0 ${Math.round(size * 10)}px rgba(32,200,200,${(bright * 0.3).toFixed(2)})`,
    };
  }), []);

  return (
    <>
      {flies.map(f => (
        <div key={f.id} style={{
          position: 'absolute',
          left: f.left, top: f.top,
          width: f.size, height: f.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, #e0fffa, #40e0d0)`,
          boxShadow: f.glow,
          pointerEvents: 'none',
          animation: `firefly-drift ${f.driftDur} ease-in-out ${f.driftDelay} infinite, firefly-pulse ${f.pulseDur} ease-in-out ${f.pulseDelay} infinite`,
          '--dx': f.driftX,
          '--dy': f.driftY,
        } as React.CSSProperties} />
      ))}
    </>
  );
}

type View = 'home' | 'loading' | 'intro' | 'setup' | 'jogar' | 'preview' | 'creditos';

const isTestMode = typeof window !== 'undefined' && window.location.search.includes('test');

interface Props {
  /** Volta para a aba Jogos do Corujão. */
  onExitApp: () => void;
}

export default function EscapeGame({ onExitApp }: Props) {
  const [view, setView] = useState<View>('home');
  // para onde ir depois da tela de carregamento
  const [loadTarget, setLoadTarget] = useState<'intro' | 'jogar'>('intro');
  const [devStart, setDevStart] = useState<{ beat: number; bg?: SceneBg } | null>(null);
  const [showDevMenu, setShowDevMenu] = useState(false);
  // remonta o StoryGame do zero em "JOGAR DE NOVO"
  const [gameKey, setGameKey] = useState(0);
  // checkpoint salvo (para o botão CONTINUAR); relido ao voltar à home
  const [save, setSave] = useState(() => getSave());
  useEffect(() => { if (view === 'home') setSave(getSave()); }, [view]);
  // quiz do professor (quando o aluno abre um link/QR compartilhado)
  const [quiz, setQuiz] = useState<SharedQuiz | null>(null);

  // Link/QR compartilhado pelo professor: #jogo=<quiz codificado>.
  // A navegação interna (setup/preview/créditos) usa só estado — sem hash —
  // para não interferir nas rotas do Corujão.
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#jogo=')) {
        const q = decodeQuiz(hash.slice('#jogo='.length));
        if (q && (q.questions.length > 0 || q.pairs.length > 0)) {
          setQuiz(q);
          resetStats(); clearSave(); setDevStart(null); setGameKey(k => k + 1);
          setLoadTarget('intro'); setView('loading');
          startMusic();
          return;
        }
        // link inválido: cai na home do jogo
        window.location.hash = '';
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Tema da tela inicial: toca em loop enquanto view === 'home'.
  // Os navegadores bloqueiam autoplay sem interação, então tentamos tocar
  // direto (funciona se o navegador permitir) e, se falhar, disparamos na
  // PRIMEIRA interação de qualquer tipo — mover o mouse, rolar, tocar a
  // tela ou apertar uma tecla — não só ao clicar num botão. Assim a música
  // começa o quanto antes, sem depender de o usuário clicar em JOGAR.
  useEffect(() => {
    if (view !== 'home') { stopHomeTheme(); return; }
    startHomeTheme();
    const EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'scroll', 'wheel', 'click'] as const;
    const kick = () => { startHomeTheme(); cleanup(); };
    const cleanup = () => EVENTS.forEach(ev => window.removeEventListener(ev, kick, true));
    EVENTS.forEach(ev => window.addEventListener(ev, kick, { capture: true, passive: true }));
    return cleanup;
  }, [view]);

  // Garante silêncio ao desmontar (sair para o Corujão em qualquer tela)
  useEffect(() => () => { stopMusic(); stopHomeTheme(); }, []);

  const goHome = () => { stopMusic(); setQuiz(null); if (window.location.hash) window.location.hash = ''; setView('home'); };
  const exitToApp = () => { stopMusic(); stopHomeTheme(); if (window.location.hash) window.location.hash = ''; onExitApp(); };

  let content: React.ReactNode;

  if (view === 'setup') {
    // ── TELA DO PROFESSOR (criador de perguntas/jornada) ──
    content = <SetupWizard onGameCreated={(_config: GameConfig) => { goHome(); }} />;
  } else if (view === 'preview') {
    // ── PREVIEW — galeria de cenários ──
    content = <ScenePreview onBack={() => setView('home')} />;
  } else if (view === 'creditos') {
    // ── CRÉDITOS — atribuições de arte, áudio, fontes e tecnologia ──
    content = <Credits onBack={() => setView('home')} />;
  } else if (view === 'loading') {
    // ── LOADING — pré-carrega as imagens antes de começar ──
    content = <LoadingScreen onDone={() => setView(loadTarget)} />;
  } else if (view === 'intro') {
    // ── INTRO — sequência ilustrada antes do jogo ──
    content = <IntroSequence onDone={() => setView('jogar')} />;
  } else if (view === 'jogar') {
    // ── JOGAR — aventura narrativa (visual novel + caminhada) ──
    content = <StoryGame key={gameKey}
      onExit={() => { setDevStart(null); goHome(); }}
      onRestart={() => { resetStats(); clearSave(); setDevStart(null); setGameKey(k => k + 1); }}
      startBeat={devStart?.beat} startBg={devStart?.bg} quiz={quiz} />;
  } else {
    // ── TELA INICIAL ──────────────────────────────────────
    content = (
      <div className="fixed inset-0 overflow-hidden scene-fade-in" style={{ touchAction: 'none' }}>

        {/* ── ARTE DE FUNDO — floresta ── */}
        <img src="/escape-assets/landing-forest.png" alt="" style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center top',
          pointerEvents: 'none',
          animation: 'bg-breathe 7s ease-in-out infinite',
          transformOrigin: 'center center',
        }} />

        {/* ── LOGO — sobre a floresta ── */}
        <img src="/escape-assets/landing-logo.png" alt="logo" style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center top',
          pointerEvents: 'none',
          animation: 'logo-float 3.8s ease-in-out infinite',
        }} />

        {/* ── PERSONAGEM — topo ── */}
        <img src="/escape-assets/landing-char.png" alt="" style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center top',
          pointerEvents: 'none',
        }} />

        {/* ── SHIMMER TELA TODA ── */}
        <div className="screen-shimmer" />

        {/* ── VAGA-LUMES ── */}
        <Fireflies />

        {/* ── VOLTAR AO CORUJÃO — canto superior esquerdo ── */}
        <button
          onClick={exitToApp}
          className="font-pixel"
          style={{
            position: 'absolute', top: 14, left: 14, zIndex: 20,
            background: 'rgba(4,18,6,0.72)', border: '2px solid rgba(207,232,192,0.55)',
            color: '#cfe8c0', fontSize: 10, letterSpacing: 1, borderRadius: 8,
            padding: '10px 14px', cursor: 'pointer', textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}
        >
          ← VOLTAR
        </button>

        {/* Gradiente escuro só na faixa dos botões (não cobre o personagem) */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 180,
          background: 'linear-gradient(to bottom, transparent 0%, rgba(4,18,6,0.82) 55%, rgba(2,10,3,0.95) 100%)',
          pointerEvents: 'none',
        }} />

        {/* ── BOTÕES — fixos no rodapé ── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 14, padding: '0 32px 127px',
        }}>
          {save && (
            <button
              onClick={() => { startMusic(); setQuiz(null); setDevStart({ beat: save.checkpoint }); setGameKey(k => k + 1); setLoadTarget('jogar'); setView('loading'); }}
              className="btn-game font-pixel w-full"
              style={{ fontSize: 13, padding: '17px 8px', maxWidth: 320 }}
            >
              CONTINUAR
            </button>
          )}
          <button
            onClick={() => { startMusic(); setQuiz(null); resetStats(); clearSave(); setDevStart(null); setGameKey(k => k + 1); setLoadTarget('intro'); setView('loading'); }}
            className="btn-game font-pixel w-full"
            style={save ? {
              fontSize: 13, padding: '17px 8px', maxWidth: 320,
              filter: 'saturate(0.75) brightness(0.9)',
            } : { fontSize: 13, padding: '17px 8px', maxWidth: 320 }}
          >
            {save ? 'NOVO JOGO' : 'JOGAR'}
          </button>

          <button
            onClick={() => setView('setup')}
            className="btn-game font-pixel w-full"
            style={{
              background: 'linear-gradient(to bottom, #b06010 0% 12.5%, #f0a010 12.5% 87.5%, #f0c840 87.5% 100%)',
              boxShadow: 'inset 4px 0 0 #b06010, inset -4px 0 0 #f0c840, 0 6px 0 #0d2a0d, 0 8px 0 rgba(0,0,0,0.35)',
              fontSize: 13, padding: '17px 8px', maxWidth: 320,
            }}
          >
            CRIAR
          </button>

          {/* link discreto de créditos — não compete com os botões principais */}
          <button
            onClick={() => setView('creditos')}
            className="font-pixel"
            style={{
              marginTop: 2, background: 'transparent', border: 'none',
              color: 'rgba(207,232,192,0.7)', fontSize: 9, letterSpacing: 1,
              padding: '6px 10px', cursor: 'pointer', textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            CRÉDITOS
          </button>
        </div>

        {/* ── PAINEL DEV — visível em dev local OU com ?test na URL ── */}
        {(import.meta.env.DEV || isTestMode) && (
          <>
            <button
              onClick={() => setShowDevMenu(m => !m)}
              style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 90, background: 'rgba(0,0,0,0.7)', border: '1px solid #40e0d0', color: '#40e0d0', fontFamily: 'monospace', fontSize: 11, padding: '8px 14px', borderRadius: 4, cursor: 'pointer' }}>
              DEV
            </button>
            {showDevMenu && (
              <div style={{ position: 'absolute', bottom: 48, right: 12, zIndex: 90, background: 'rgba(6,14,7,0.97)', border: '1px solid #40e0d0', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260 }}>
                <button
                  onClick={async () => {
                    if ('serviceWorker' in navigator) {
                      const regs = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(regs.map(r => r.unregister()));
                    }
                    if ('caches' in window) {
                      const keys = await caches.keys();
                      await Promise.all(keys.map(k => caches.delete(k)));
                    }
                    window.location.reload();
                  }}
                  style={{ background: '#1a0a00', border: '1px solid #ff6020', color: '#ff9060', fontFamily: 'monospace', fontSize: 11, padding: '10px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'left', fontWeight: 'bold' }}>
                  ♻ Forçar atualização
                </button>
                <div style={{ color: '#40e0d0', fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, marginTop: 4, marginBottom: 0 }}>PULAR PARA</div>
                <button
                  onClick={() => { setShowDevMenu(false); setView('preview'); }}
                  style={{ background: '#101a20', border: '1px solid #40e0d0', color: '#40e0d0', fontFamily: 'monospace', fontSize: 11, padding: '10px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'left' }}>
                  🖼 Preview Cenários (5 packs)
                </button>
                {DEV_ACTS.map(act => (
                  <button key={act.beat}
                    onClick={() => { startMusic(); setQuiz(null); setDevStart({ beat: act.beat, bg: act.bg }); setShowDevMenu(false); setView('jogar'); }}
                    style={{ background: '#0d1f10', border: '1px solid #2a4a2e', color: '#cfe8c8', fontFamily: 'monospace', fontSize: 11, padding: '10px 12px', borderRadius: 4, cursor: 'pointer', textAlign: 'left' }}>
                    {act.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    );
  }

  // Overlay em tela cheia acima da UI do Corujão (nav z-50, modais até z-[130])
  return <div className="fixed inset-0 z-[150] bg-[#2d5a1b]">{content}</div>;
}
