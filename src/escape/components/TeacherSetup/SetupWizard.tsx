import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { GameConfig, GameStory, MCQuestion, MatchPair } from '../../types/game';
import { DEFAULT_NARRATIVE_CHOICES } from '../../data/narrative';
import { hasApiKey, saveApiKey, resolveApiKey } from '../../ai/gemini';
import { shareUrl, type SharedQuiz } from '../../game/quizShare';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

interface Props {
  onGameCreated: (config: GameConfig) => void;
}

type Mode = 'input' | 'generating' | 'review' | 'share';

function uid() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}
function emptyQ(): MCQuestion {
  return { text: '', options: ['', '', '', ''], correct: 0 };
}
function emptyPair(): MatchPair {
  return { concept: '', definition: '' };
}

const LEVELS = ['Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio', 'Ensino Superior'];

const GEN_MESSAGES = [
  'Consultando os guardiões do Éter...',
  'Transformando seu conteúdo em desafios...',
  'Criando perguntas e enigmas...',
  'Adaptando a história à sua disciplina...',
  'Equilibrando as batalhas...',
];

export default function SetupWizard({ onGameCreated }: Props) {
  const [mode, setMode] = useState<Mode>('input');
  const [subject, setSubject] = useState('');
  const [level, setLevel] = useState(LEVELS[1]);
  const [instructions, setInstructions] = useState('');
  const [apiKey, setApiKeyState] = useState(resolveApiKey());
  const [genMsg, setGenMsg] = useState(GEN_MESSAGES[0]);

  const [story, setStory] = useState<GameStory | undefined>(undefined);
  const [narratives, setNarratives] = useState({
    forest: DEFAULT_NARRATIVE_CHOICES.forest,
    city: DEFAULT_NARRATIVE_CHOICES.city,
    caves: DEFAULT_NARRATIVE_CHOICES.caves,
  });
  const [forestQs, setForestQs] = useState<MCQuestion[]>([emptyQ(), emptyQ(), emptyQ()]);
  const [cityPairs, setCityPairs] = useState<MatchPair[]>([emptyPair(), emptyPair(), emptyPair(), emptyPair()]);
  const [cavesQs, setCavesQs] = useState<MCQuestion[]>([emptyQ(), emptyQ(), emptyQ(), emptyQ(), emptyQ()]);
  const [towerQs, setTowerQs] = useState<MCQuestion[]>([emptyQ(), emptyQ(), emptyQ()]);

  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shareLink, setShareLink] = useState('');   // link/QR do jogo compartilhado
  const [copied, setCopied] = useState(false);
  const [regenTarget, setRegenTarget] = useState<{ bank: 'forest' | 'caves' | 'tower'; idx: number } | null>(null);
  const [regenPairIdx, setRegenPairIdx] = useState<number | null>(null);

  const keyAvailable = hasApiKey() || apiKey.trim().length > 10;

  const handleGenerate = async () => {
    if (!subject.trim()) { setError('Digite o conteúdo/assunto da aula.'); return; }
    if (apiKey.trim()) saveApiKey(apiKey.trim());
    if (!keyAvailable) { setError('Cole uma chave do Google Gemini para a IA gerar o jogo (ou crie manualmente).'); return; }

    setError('');
    setMode('generating');
    let i = 0;
    const ticker = setInterval(() => { i = (i + 1) % GEN_MESSAGES.length; setGenMsg(GEN_MESSAGES[i]); }, 1600);

    try {
      const { generateGame } = await import('../../ai/generateGame');
      const { config, warnings } = await generateGame(subject, level, instructions);
      clearInterval(ticker);
      setStory(config.story);
      setNarratives({
        forest: config.scenes.forest.narrative,
        city: config.scenes.city.narrative,
        caves: config.scenes.caves.narrative,
      });
      setForestQs(config.scenes.forest.questions.length ? config.scenes.forest.questions : [emptyQ(), emptyQ(), emptyQ()]);
      setCityPairs(config.scenes.city.pairs.length ? config.scenes.city.pairs : [emptyPair(), emptyPair(), emptyPair(), emptyPair()]);
      setCavesQs(config.scenes.caves.questions.length ? config.scenes.caves.questions : [emptyQ(), emptyQ(), emptyQ(), emptyQ(), emptyQ()]);
      setTowerQs(config.scenes.tower.questions.length ? config.scenes.tower.questions : [emptyQ(), emptyQ(), emptyQ()]);
      setWarnings(warnings);
      setMode('review');
    } catch (e) {
      clearInterval(ticker);
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'NO_API_KEY') setError('Chave da IA não configurada.');
      else if (msg === 'PARSE_ERROR') setError('A IA retornou um formato inesperado. Tente gerar novamente.');
      else setError('Não foi possível gerar agora. Verifique a chave/conexão e tente de novo.');
      setMode('input');
    }
  };

  const handleManual = () => {
    setStory(undefined);
    setWarnings([]);
    setMode('review');
  };

  // Monta o quiz que vai no link/QR (só perguntas + pareamento preenchidos)
  const buildQuiz = (): SharedQuiz => ({
    subject: subject.trim(),
    level,
    questions: [...forestQs, ...cavesQs, ...towerQs].filter(q => q.text.trim()),
    pairs: cityPairs.filter(p => p.concept.trim() && p.definition.trim()),
  });

  // GameConfig completo (para o salvamento e o callback de conclusão)
  const buildConfig = (): GameConfig => ({
    id: uid(),
    subject: subject.trim(),
    level,
    createdAt: Date.now(),
    story,
    scenes: {
      forest: { questions: forestQs, narrative: narratives.forest },
      city: { pairs: cityPairs, narrative: narratives.city },
      caves: { questions: cavesQs, narrative: narratives.caves },
      tower: { questions: towerQs },
    },
    assets: {},
  });

  const handleSave = async () => {
    if (!subject.trim()) { setError('Informe o conteúdo da aula.'); return; }
    const quiz = buildQuiz();
    if (quiz.questions.length === 0 && quiz.pairs.length === 0) {
      setError('Adicione ao menos uma pergunta ou um par antes de gerar o jogo.');
      return;
    }
    setSaving(true);
    setError('');
    // gera o link de compartilhamento — funciona 100% sem backend
    setShareLink(shareUrl(quiz));

    // salva uma cópia no Firestore como best-effort (não bloqueia nada)
    const config = buildConfig();
    try { await setDoc(doc(db, 'games', config.id), config); } catch { /* ignora — o link já é autossuficiente */ }

    setSaving(false);
    setCopied(false);
    setMode('share');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard indisponível — o link fica visível para copiar manualmente */ }
  };

  const updateQ = (
    setter: React.Dispatch<React.SetStateAction<MCQuestion[]>>,
    idx: number,
    field: 'text' | 'correct' | 'opt0' | 'opt1' | 'opt2' | 'opt3',
    value: string | number,
  ) => {
    setter(prev => prev.map((q, i) => {
      if (i !== idx) return q;
      if (field === 'text') return { ...q, text: value as string };
      if (field === 'correct') return { ...q, correct: value as 0 | 1 | 2 | 3 };
      const optIdx = parseInt(field[3]);
      const opts = [...q.options] as [string, string, string, string];
      opts[optIdx] = value as string;
      return { ...q, options: opts };
    }));
  };
  const updatePair = (idx: number, field: 'concept' | 'definition', value: string) => {
    setCityPairs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const handleRegenQ = async (bank: 'forest' | 'caves' | 'tower', idx: number, setter: React.Dispatch<React.SetStateAction<MCQuestion[]>>) => {
    if (regenTarget !== null || !keyAvailable) return;
    setRegenTarget({ bank, idx });
    try {
      const { regenerateQuestion } = await import('../../ai/generateGame');
      const newQ = await regenerateQuestion(subject, level, bank);
      setter(prev => prev.map((q, i) => i === idx ? newQ : q));
    } catch { /* silently keep old question */ } finally {
      setRegenTarget(null);
    }
  };

  const handleRegenPair = async (idx: number) => {
    if (regenPairIdx !== null || !keyAvailable) return;
    setRegenPairIdx(idx);
    try {
      const { regeneratePair } = await import('../../ai/generateGame');
      const newPair = await regeneratePair(subject, level);
      setCityPairs(prev => prev.map((p, i) => i === idx ? newPair : p));
    } catch { /* silently keep old pair */ } finally {
      setRegenPairIdx(null);
    }
  };

  const QEditor = ({ questions, setter, label, bank }: {
    questions: MCQuestion[];
    setter: React.Dispatch<React.SetStateAction<MCQuestion[]>>;
    label: string;
    bank: 'forest' | 'caves' | 'tower';
  }) => (
    <div className="flex flex-col gap-3">
      <p className="font-pixel" style={{ color: '#7a4f2d', fontSize: 7 }}>{label}</p>
      {questions.map((q, idx) => {
        const isRegening = regenTarget?.bank === bank && regenTarget.idx === idx;
        return (
          <div key={idx} className="panel-parchment p-3" style={{ background: '#f0e4c8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <p className="font-vt" style={{ color: '#7a4f1a', fontSize: 16 }}>Pergunta {idx + 1}</p>
              {keyAvailable && (
                <button
                  onClick={() => handleRegenQ(bank, idx, setter)}
                  disabled={regenTarget !== null}
                  style={{
                    background: isRegening ? '#555' : '#1a4a8a',
                    color: '#fff', border: '2px solid #0a2a5a',
                    boxShadow: '2px 2px 0 #000',
                    fontFamily: 'VT323, monospace', fontSize: 14,
                    padding: '2px 10px', cursor: regenTarget !== null ? 'wait' : 'pointer',
                    opacity: regenTarget !== null && !isRegening ? 0.45 : 1,
                  }}
                >
                  {isRegening ? '⏳ Gerando...' : '🤖 Refazer'}
                </button>
              )}
            </div>
            <textarea
              value={q.text}
              onChange={e => updateQ(setter, idx, 'text', e.target.value)}
              placeholder="Digite a pergunta..."
              rows={2}
              className="input-rpg w-full px-3 py-2"
              style={{ resize: 'none', fontSize: 16, fontFamily: 'VT323, monospace' }}
            />
            <div className="flex flex-col gap-1 mt-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <button
                    onClick={() => updateQ(setter, idx, 'correct', oi)}
                    style={{
                      width: 22, height: 22, flexShrink: 0, cursor: 'pointer',
                      background: q.correct === oi ? '#2a8c2a' : '#e8d4a8',
                      border: `2px solid ${q.correct === oi ? '#1a5c1a' : '#7a5828'}`,
                      boxShadow: q.correct === oi ? 'inset 0 2px 0 rgba(0,0,0,0.2)' : 'none',
                    }}
                    title="Marcar como correta"
                  />
                  <span className="font-pixel flex-shrink-0" style={{ color: '#7a4f2d', fontSize: 8, width: 12 }}>{String.fromCharCode(65 + oi)}</span>
                  <input
                    value={opt}
                    onChange={e => updateQ(setter, idx, `opt${oi}` as 'opt0', e.target.value)}
                    placeholder={`Opção ${String.fromCharCode(65 + oi)}`}
                    className="input-rpg flex-1 px-2 py-1"
                    style={{ fontSize: 15 }}
                  />
                </div>
              ))}
            </div>
            <p className="font-vt mt-1" style={{ color: '#2a7c1a', fontSize: 15 }}>✓ Correta: {String.fromCharCode(65 + q.correct)}</p>
          </div>
        );
      })}
    </div>
  );

  const sceneStyle = {
    background: 'linear-gradient(to bottom, #5ba3d8 0%, #8ec8f5 38%, #c5e8fd 58%, #a8d46b 78%, #4a8a1a 100%)',
  };

  // ───────────────── INPUT ─────────────────
  if (mode === 'input') {
    return (
      <div className="fixed inset-0 overflow-y-auto no-scrollbar" style={sceneStyle}>
        {/* Header */}
        <div className="bar-wood flex items-center justify-between px-4 py-3">
          <p className="font-pixel" style={{ color: '#f7ead5', fontSize: 9, textShadow: '1px 2px 0 #1a0c04' }}>🎓 PROFESSOR</p>
          <p className="font-pixel" style={{ color: '#ffd700', fontSize: 7 }}>ÉTER</p>
        </div>

        <div className="max-w-lg mx-auto px-5 py-5 pb-16">
          <div className="panel-parchment px-5 py-5 flex flex-col gap-4" style={{ background: 'linear-gradient(160deg,#f7ead5,#e8d4a8)' }}>
            <div className="text-center">
              <p className="font-pixel" style={{ color: '#3a1a00', fontSize: 10, lineHeight: 2 }}>CRIAR JORNADA</p>
              <p className="font-vt" style={{ color: '#7a4f2d', fontSize: 16 }}>A IA vai transformar sua aula num jogo RPG</p>
            </div>

            <div>
              <label className="font-pixel block mb-2" style={{ color: '#7a4f2d', fontSize: 7 }}>📚 CONTEÚDO DA AULA</label>
              <input
                className="input-rpg w-full px-3 py-3"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Ex: Fotossíntese, Revolução Francesa..."
                autoFocus
              />
            </div>

            <div>
              <label className="font-pixel block mb-2" style={{ color: '#7a4f2d', fontSize: 7 }}>🎓 NÍVEL</label>
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map(l => (
                  <button
                    key={l}
                    onClick={() => setLevel(l)}
                    className="font-vt py-2 px-2"
                    style={{
                      background: level === l ? '#c88f20' : '#e8d4a8',
                      color: level === l ? '#fff' : '#5a3a10',
                      border: `3px solid ${level === l ? '#7a4f1a' : '#c4a068'}`,
                      boxShadow: level === l ? '3px 3px 0 #4a2d08' : '2px 2px 0 #b09060',
                      fontSize: 15,
                      cursor: 'pointer',
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {!hasApiKey() && (
              <div>
                <label className="font-pixel block mb-2" style={{ color: '#5a3a10', fontSize: 6 }}>
                  🔑 CHAVE GEMINI (grátis em aistudio.google.com/apikey)
                </label>
                <input
                  className="input-rpg w-full px-3 py-2"
                  value={apiKey}
                  onChange={e => setApiKeyState(e.target.value)}
                  placeholder="Cole sua chave da IA..."
                  type="password"
                />
              </div>
            )}

            <div>
              <label className="font-pixel block mb-2" style={{ color: '#7a4f2d', fontSize: 6 }}>
                💬 INSTRUÇÕES PARA A IA (OPCIONAL)
              </label>
              <textarea
                className="input-rpg w-full px-3 py-2"
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                placeholder="Ex: Foco em ecossistemas brasileiros, linguagem para crianças de 8 anos..."
                rows={2}
                style={{ resize: 'none', fontSize: 15, fontFamily: 'VT323, monospace' }}
              />
            </div>

            {error && (
              <div style={{ background: '#ffe8e8', border: '2px solid #cc2222', padding: '8px 12px' }}>
                <p className="font-vt" style={{ color: '#cc2222', fontSize: 16 }}>{error}</p>
              </div>
            )}
          </div>

          <button
            onClick={handleGenerate}
            className="btn-rpg w-full py-4 mt-4 font-pixel"
            style={{ fontSize: 9 }}
          >
            ✨ GERAR JOGO COM IA
          </button>
          <p className="font-vt text-center mt-1" style={{ color: '#1a5a04', fontSize: 15 }}>
            A IA cria perguntas, enigmas e história para o seu conteúdo
          </p>

          <button
            onClick={handleManual}
            className="font-vt w-full mt-4"
            style={{ background: 'rgba(255,255,255,0.4)', border: '2px solid #7a5828', color: '#3a2010', padding: '10px', fontSize: 16, cursor: 'pointer' }}
          >
            ✏️ Montar manualmente
          </button>
        </div>
      </div>
    );
  }

  // ───────────────── GENERATING ─────────────────
  if (mode === 'generating') {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6" style={sceneStyle}>
        <div className="panel-parchment px-8 py-8 flex flex-col items-center gap-5 max-w-xs w-full">
          <div className="portal-spin" style={{ width: 72, height: 72, borderRadius: '50%', border: '4px solid #c88f20', boxShadow: '0 0 24px #c88f20, inset 0 0 20px rgba(200,143,32,0.3)' }} />
          <p className="font-pixel text-center" style={{ color: '#3a1a00', fontSize: 8, lineHeight: 2 }}>GERANDO JORNADA</p>
          <p className="font-vt text-center" style={{ color: '#7a4f2d', fontSize: 18, minHeight: 26 }}>{genMsg}</p>
          <p className="font-vt text-center" style={{ color: '#a88060', fontSize: 14 }}>Pode levar alguns segundos...</p>
        </div>
      </div>
    );
  }

  // ───────────────── COMPARTILHAR ─────────────────
  if (mode === 'share') {
    const nQ = buildQuiz().questions.length;
    const nP = buildQuiz().pairs.length;
    return (
      <div className="fixed inset-0 overflow-y-auto no-scrollbar flex flex-col items-center px-5 py-8 gap-5" style={sceneStyle}>
        <div className="panel-parchment px-6 py-6 flex flex-col items-center gap-4 w-full" style={{ maxWidth: 380 }}>
          <p className="font-pixel text-center" style={{ color: '#1a5c1a', fontSize: 11, lineHeight: 1.8 }}>✅ JOGO PRONTO!</p>
          <p className="font-vt text-center" style={{ color: '#5a3a1a', fontSize: 18, lineHeight: 1.3 }}>
            {subject.trim()}
          </p>
          <p className="font-vt text-center" style={{ color: '#7a5a3a', fontSize: 15 }}>
            {nQ} pergunta{nQ === 1 ? '' : 's'} · {nP} par{nP === 1 ? '' : 'es'} de conexão
          </p>

          {/* QR CODE — o aluno escaneia para jogar */}
          <div style={{ background: '#fff', padding: 14, borderRadius: 8, boxShadow: '0 3px 0 rgba(0,0,0,0.25)' }}>
            <QRCodeSVG value={shareLink} size={208} level="M" marginSize={1} />
          </div>
          <p className="font-vt text-center" style={{ color: '#7a5a3a', fontSize: 15, lineHeight: 1.3 }}>
            Peça para os alunos <b>escanearem o QR code</b> com a câmera do celular.
          </p>

          {/* LINK — alternativa ao QR (WhatsApp, Classroom, etc.) */}
          <div className="w-full flex flex-col gap-2">
            <p className="font-pixel" style={{ color: '#7a4f2d', fontSize: 7 }}>OU COMPARTILHE O LINK</p>
            <textarea
              readOnly
              value={shareLink}
              onFocus={(e) => e.target.select()}
              className="font-vt w-full px-3 py-2"
              style={{ background: '#fff8e8', border: '2px solid #b8935a', color: '#5a3a1a', fontSize: 13, resize: 'none', height: 56, borderRadius: 4 }}
            />
            <button onClick={copyLink} className="btn-rpg w-full py-2 font-pixel" style={{ fontSize: 8 }}>
              {copied ? '✅ LINK COPIADO!' : '📋 COPIAR LINK'}
            </button>
          </div>

          {shareLink.length > 1900 && (
            <p className="font-vt text-center" style={{ color: '#b05a1a', fontSize: 13, lineHeight: 1.3 }}>
              ⚠️ Muitas perguntas deixaram o QR code denso. Se algum celular tiver dificuldade de ler, use o link.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full" style={{ maxWidth: 380 }}>
          <button
            onClick={() => { window.location.hash = shareLink.slice(shareLink.indexOf('#')); }}
            className="btn-rpg w-full py-3 font-pixel"
            style={{ fontSize: 9 }}
          >
            🎮 TESTAR O JOGO
          </button>
          <button
            onClick={() => { setMode('review'); }}
            className="btn-rpg w-full py-3 font-pixel"
            style={{ background: 'linear-gradient(to bottom, #a87830, #886020)', fontSize: 8 }}
          >
            ← EDITAR PERGUNTAS
          </button>
          <button
            onClick={() => onGameCreated(buildConfig())}
            className="btn-rpg w-full py-3 font-pixel"
            style={{ background: 'linear-gradient(to bottom, #8a8a8a, #6a6a6a)', fontSize: 8 }}
          >
            CONCLUIR
          </button>
        </div>
      </div>
    );
  }

  // ───────────────── REVIEW ─────────────────
  return (
    <div className="fixed inset-0 overflow-y-auto no-scrollbar" style={{ background: '#e8d4a8' }}>
      {/* Header */}
      <div className="bar-wood flex items-center justify-between px-4 py-3 sticky top-0 z-20">
        <p className="font-pixel" style={{ color: '#f7ead5', fontSize: 7 }}>REVISÃO DO JOGO</p>
        <p className="font-vt" style={{ color: '#ffd700', fontSize: 16 }}>{subject} · {level}</p>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 pb-28">
        {story?.hook && (
          <div className="panel-parchment p-3 mb-4" style={{ background: 'linear-gradient(160deg,#fffbe8,#f0d890)', borderColor: '#c88f20' }}>
            <p className="font-pixel mb-1" style={{ color: '#7a4f1a', fontSize: 6 }}>✦ HISTÓRIA GERADA PELA IA</p>
            <p className="font-vt" style={{ color: '#3a1a00', fontSize: 17 }}>{story.hook}</p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 p-3" style={{ background: '#fff8e0', border: '2px solid #c88f20' }}>
            {warnings.map((w, i) => (
              <p key={i} className="font-vt" style={{ color: '#8b5e00', fontSize: 15 }}>⚠ {w} Você pode completar abaixo.</p>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-7">
          <QEditor questions={forestQs} setter={setForestQs} label="🌲 FLORESTA — 3 PERGUNTAS" bank="forest" />

          <div className="flex flex-col gap-3">
            <p className="font-pixel" style={{ color: '#7a4f2d', fontSize: 7 }}>🏙️ CIDADE — 4 PARES (CONCEITO ↔ DEFINIÇÃO)</p>
            {cityPairs.map((pair, idx) => {
              const isPairRegen = regenPairIdx === idx;
              return (
                <div key={idx} className="panel-parchment p-3" style={{ background: '#f0e4c8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <p className="font-vt" style={{ color: '#7a4f1a', fontSize: 16 }}>Par {idx + 1}</p>
                    {keyAvailable && (
                      <button
                        onClick={() => handleRegenPair(idx)}
                        disabled={regenPairIdx !== null}
                        style={{
                          background: isPairRegen ? '#555' : '#1a4a8a',
                          color: '#fff', border: '2px solid #0a2a5a',
                          boxShadow: '2px 2px 0 #000',
                          fontFamily: 'VT323, monospace', fontSize: 14,
                          padding: '2px 10px', cursor: regenPairIdx !== null ? 'wait' : 'pointer',
                          opacity: regenPairIdx !== null && !isPairRegen ? 0.45 : 1,
                        }}
                      >
                        {isPairRegen ? '⏳ Gerando...' : '🤖 Refazer par'}
                      </button>
                    )}
                  </div>
                  <input value={pair.concept} onChange={e => updatePair(idx, 'concept', e.target.value)} placeholder="Conceito" className="input-rpg w-full px-3 py-2 mb-2" />
                  <input value={pair.definition} onChange={e => updatePair(idx, 'definition', e.target.value)} placeholder="Definição" className="input-rpg w-full px-3 py-2" />
                </div>
              );
            })}
          </div>

          <QEditor questions={cavesQs} setter={setCavesQs} label="💎 CAVERNAS — 5 PERGUNTAS" bank="caves" />
          <QEditor questions={towerQs} setter={setTowerQs} label="👑 BATALHAS — 3 PERGUNTAS DE SÍNTESE" bank="tower" />
        </div>

        {error && (
          <div className="mt-4 p-3" style={{ background: '#ffe8e8', border: '2px solid #cc2222' }}>
            <p className="font-vt text-center" style={{ color: '#cc2222', fontSize: 16 }}>{error}</p>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 flex gap-3 p-4 bar-wood" style={{ borderTop: 'none', borderBottom: 'none', borderLeft: 'none', borderRight: 'none', borderTopWidth: 3 }}>
        <button
          onClick={() => { setMode('input'); setError(''); }}
          className="btn-rpg flex-1 py-3 font-pixel"
          style={{ background: 'linear-gradient(to bottom, #a87830, #886020)', fontSize: 8 }}
        >
          ← VOLTAR
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-rpg flex-1 py-3 font-pixel"
          style={{ fontSize: 8 }}
        >
          {saving ? 'SALVANDO...' : '🎮 CRIAR JOGO'}
        </button>
      </div>
    </div>
  );
}
