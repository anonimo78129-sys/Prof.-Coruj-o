import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, ChevronRight, Copy, Flame, Play, Trophy, Users, X, Zap } from 'lucide-react';
import {
  calcularPlacar, encerrar, iniciarPergunta, limparRespostas, ordenar,
  ouvirEquipes, ouvirRespostas, ouvirSala, revelar, salaUrl,
} from './sala';
import type { Equipe, Resposta, Sala } from './tipos';

const CORES = ['#dc4b4b', '#e0ab2e', '#3fae6c', '#3d7fd6'];

/**
 * Tela do professor — a que vai na projeção. É ela que conduz o jogo e, mais
 * importante, é o ÁRBITRO: só este aparelho calcula e grava o placar.
 *
 * O professor toca em um botão só ("Próxima"). Revelar acontece sozinho, quando
 * a última equipe responde ou quando o tempo acaba — o que vier primeiro. Sem
 * isso, uma equipe com o celular travado congelaria a aula inteira.
 */
export default function SalaProfessor({ codigo, onFechar }: { codigo: string; onFechar: () => void }) {
  const [sala, setSala] = useState<Sala | null>(null);
  const [equipes, setEquipes] = useState<Record<string, Equipe>>({});
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [agora, setAgora] = useState(Date.now());
  const [copiado, setCopiado] = useState(false);
  const revelandoRef = useRef(false);

  const link = useMemo(() => salaUrl(codigo), [codigo]);

  useEffect(() => {
    const un1 = ouvirSala(codigo, setSala);
    const un2 = ouvirEquipes(codigo, setEquipes);
    return () => { un1(); un2(); };
  }, [codigo]);

  useEffect(() => {
    if (!sala || sala.status !== 'pergunta') { setRespostas([]); return; }
    return ouvirRespostas(codigo, sala.perguntaAtual, setRespostas);
  }, [codigo, sala?.status, sala?.perguntaAtual]);

  // Relógio da tela. Só o aparelho do professor decide quando o tempo acabou —
  // assim uma diferença de relógio no celular do aluno não muda o resultado.
  useEffect(() => {
    if (sala?.status !== 'pergunta') return;
    const id = setInterval(() => setAgora(Date.now()), 200);
    return () => clearInterval(id);
  }, [sala?.status]);

  const iniciadaMs = sala?.perguntaIniciadaEm ? sala.perguntaIniciadaEm.toMillis() : 0;
  const totalMs = (sala?.segundos ?? 20) * 1000;
  const restanteMs = iniciadaMs ? Math.max(0, totalMs - (agora - iniciadaMs)) : totalMs;
  const pergunta = sala?.perguntas?.[sala.perguntaAtual];
  const nEquipes = Object.keys(equipes).length;
  const nResponderam = respostas.length;
  const classificacao = useMemo(() => ordenar(equipes, sala?.placar ?? {}), [equipes, sala?.placar]);

  const fazerRevelacao = async () => {
    if (revelandoRef.current || !sala || !pergunta) return;
    revelandoRef.current = true;
    const placar = calcularPlacar(sala.placar ?? {}, respostas, equipes, pergunta.correct, iniciadaMs, sala.segundos);
    const ultima = sala.perguntaAtual + 1 >= sala.perguntas.length;
    try {
      if (ultima) { await encerrar(codigo, placar); await limparRespostas(codigo); }
      else await revelar(codigo, placar);
    } finally { revelandoRef.current = false; }
  };

  // Revela sozinho: todos responderam, ou o tempo acabou.
  useEffect(() => {
    if (sala?.status !== 'pergunta' || !iniciadaMs) return;
    const todos = nEquipes > 0 && nResponderam >= nEquipes;
    if (todos || restanteMs <= 0) void fazerRevelacao();
  }, [sala?.status, nResponderam, nEquipes, restanteMs, iniciadaMs]);

  const proxima = () => { if (sala) void iniciarPergunta(codigo, sala.perguntaAtual + 1); };
  const comecar = () => void iniciarPergunta(codigo, 0);

  const fechar = async () => { await limparRespostas(codigo).catch(() => {}); onFechar(); };

  const Palco = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-y-auto" style={{ background: 'linear-gradient(180deg,#345b86,#16283f)' }}>
      <div className="flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
        <div>
          <p className="text-[9px] font-black tracking-[0.25em] text-white/40">QUIZ RELÂMPAGO · SALA</p>
          <p className="text-2xl font-black text-white tracking-[0.25em] leading-none">{codigo}</p>
        </div>
        <button onClick={fechar} aria-label="Encerrar" className="w-10 h-10 rounded-full bg-black/30 flex items-center justify-center text-white/80">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 flex flex-col px-5 pb-8">{children}</div>
    </div>
  );

  if (!sala) return <Palco><div className="flex-1 flex items-center justify-center text-white/60">Carregando a sala…</div></Palco>;

  // ── LOBBY: QR na projeção, equipes entrando ────────────────────────────────
  if (sala.status === 'lobby') {
    return (
      <Palco>
        <div className="flex-1 flex flex-col items-center gap-4 max-w-md mx-auto w-full">
          <p className="text-indigo-100/80 text-sm text-center">
            Cada equipe aponta a câmera do celular para o código. Quem não conseguir,
            digita <b className="text-white">{codigo}</b> no app.
          </p>

          <div className="bg-white rounded-3xl p-4 shadow-2xl">
            <QRCodeSVG value={link} size={210} level="M" marginSize={1} />
          </div>

          <button
            onClick={async () => { try { await navigator.clipboard.writeText(link); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem clipboard */ } }}
            className="flex items-center gap-1.5 text-xs font-bold text-indigo-100/70 bg-white/10 rounded-full px-3 py-1.5"
          >
            <Copy size={12} /> {copiado ? 'Link copiado!' : 'Copiar link'}
          </button>

          <div className="w-full rounded-2xl p-4" style={{ background: 'rgba(0,0,0,0.25)' }}>
            <p className="text-[10px] font-black tracking-widest text-indigo-200/70 mb-2.5 flex items-center gap-1.5">
              <Users size={12} /> {nEquipes} EQUIPE{nEquipes === 1 ? '' : 'S'} NA SALA
            </p>
            {nEquipes === 0 ? (
              <p className="text-white/45 text-sm">Ninguém entrou ainda…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(equipes).map(([uid, e]) => (
                  <span key={uid} className="rounded-full px-3 py-1.5 text-sm font-bold text-white border border-white/20" style={{ background: 'rgba(255,255,255,0.12)' }}>
                    {e.emoji} {e.nome}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={comecar}
            disabled={nEquipes === 0}
            className="w-full rounded-2xl py-4 font-black text-white text-lg border-2 shadow-xl active:scale-[0.98] transition disabled:opacity-40"
            style={{ background: 'linear-gradient(180deg,#8b6fc4,#6a4f96)', borderColor: '#c9b6e8' }}
          >
            <Play size={20} className="inline mr-2" fill="currentColor" /> Começar o jogo
          </button>
          <p className="text-white/35 text-[11px] text-center">
            {sala.perguntas.length} perguntas · {sala.segundos}s cada
          </p>
        </div>
      </Palco>
    );
  }

  // ── PERGUNTA no ar ─────────────────────────────────────────────────────────
  if (sala.status === 'pergunta' && pergunta) {
    const pct = restanteMs / totalMs;
    const cor = pct > 0.5 ? '#5fd39a' : pct > 0.25 ? '#f2c14e' : '#f27272';
    return (
      <Palco>
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-black text-white/70 tracking-wide">
              PERGUNTA {sala.perguntaAtual + 1} <span className="text-white/40">/ {sala.perguntas.length}</span>
            </p>
            <p className="text-sm font-black text-white flex items-center gap-1.5">
              <Users size={14} className="text-white/60" />
              <span style={{ color: nResponderam >= nEquipes ? '#7bf0a6' : 'white' }}>{nResponderam}</span>
              <span className="text-white/40">de {nEquipes} responderam</span>
            </p>
          </div>

          {/* barra do tempo */}
          <div className="h-2.5 rounded-full overflow-hidden bg-black/35 mb-5">
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct * 100}%`, background: cor }} />
          </div>

          <div className="rounded-3xl p-5 mb-5 bg-[#f7efdc] shadow-2xl">
            <p className="font-extrabold text-[#3a2413] text-2xl leading-snug">{pergunta.q}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pergunta.options.map((opt, i) => (
              <div key={i} className="rounded-2xl px-4 py-4 flex items-center gap-3 border-[3px] border-white/85 shadow-lg" style={{ background: CORES[i] }}>
                <span className="w-10 h-10 rounded-xl bg-white/25 flex items-center justify-center text-white font-black text-xl shrink-0">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-white font-bold text-lg leading-snug break-words min-w-0">{opt}</span>
              </div>
            ))}
          </div>

          {/* quem já respondeu — sem mostrar O QUE respondeu */}
          <div className="flex flex-wrap gap-1.5 mt-5">
            {Object.entries(equipes).map(([uid, e]) => {
              const pronto = respostas.some(r => r.equipeUid === uid);
              return (
                <span key={uid} className="rounded-full px-2.5 py-1 text-xs font-bold border transition-colors"
                  style={{ background: pronto ? 'rgba(95,211,154,0.22)' : 'rgba(255,255,255,0.07)', borderColor: pronto ? '#5fd39a' : 'rgba(255,255,255,0.15)', color: pronto ? '#c8f6dd' : 'rgba(255,255,255,0.5)' }}>
                  {pronto && <Check size={11} className="inline mr-1" />}{e.emoji} {e.nome}
                </span>
              );
            })}
          </div>
        </div>
      </Palco>
    );
  }

  // ── REVELAÇÃO: resposta + porquê + placar ──────────────────────────────────
  if (sala.status === 'revelacao' && pergunta) {
    return (
      <Palco>
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full gap-4">
          <div className="rounded-3xl p-5 bg-[#f7efdc] shadow-2xl">
            <p className="font-extrabold text-[#3a2413] text-lg leading-snug mb-3">{pergunta.q}</p>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: '#d8f2df', border: '2px solid #3fae6c' }}>
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black shrink-0" style={{ background: CORES[pergunta.correct] }}>
                {String.fromCharCode(65 + pergunta.correct)}
              </span>
              <span className="font-bold text-[#20502f] text-base">{pergunta.options[pergunta.correct]}</span>
            </div>
            {pergunta.explain && (
              <p className="text-[#4a3a24] text-sm mt-3 leading-relaxed"><b>Por quê:</b> {pergunta.explain}</p>
            )}
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'rgba(0,0,0,0.28)' }}>
            <p className="text-[10px] font-black tracking-widest text-indigo-200/70 mb-2.5">PLACAR</p>
            {classificacao.map(e => {
              const subiu = e.anterior && e.anterior > e.posicao;
              const caiu = e.anterior && e.anterior < e.posicao;
              return (
                <div key={e.uid} className="flex items-center gap-2.5 py-1.5">
                  <span className="text-sm font-black text-white/55 w-6">{e.posicao}º</span>
                  <span className="text-lg">{e.emoji}</span>
                  <span className="text-base font-bold text-white truncate flex-1">{e.nome}</span>
                  {subiu && <span className="text-emerald-300 text-xs font-black">▲</span>}
                  {caiu && <span className="text-rose-300 text-xs font-black">▼</span>}
                  {e.streak >= 2 && <span className="flex items-center gap-0.5 text-orange-300 text-xs font-black"><Flame size={11} />{e.streak}</span>}
                  <span className="text-lg font-black text-amber-200 tabular-nums">{e.pontos}</span>
                </div>
              );
            })}
          </div>

          <button
            onClick={proxima}
            className="w-full rounded-2xl py-4 font-black text-white text-lg border-2 shadow-xl active:scale-[0.98] transition"
            style={{ background: 'linear-gradient(180deg,#8b6fc4,#6a4f96)', borderColor: '#c9b6e8' }}
          >
            Próxima pergunta <ChevronRight size={20} className="inline" />
          </button>
        </div>
      </Palco>
    );
  }

  // ── PÓDIO ──────────────────────────────────────────────────────────────────
  const podio = classificacao.slice(0, 3);
  return (
    <Palco>
      <div className="flex-1 flex flex-col items-center max-w-md mx-auto w-full gap-4">
        <p className="text-6xl mt-2">🏆</p>
        <h2 className="text-2xl font-black text-white">Fim de jogo!</h2>

        <div className="w-full rounded-2xl p-4" style={{ background: 'rgba(0,0,0,0.28)' }}>
          {podio.map((e, i) => (
            <div key={e.uid} className="flex items-center gap-3 py-2">
              <span className="text-2xl">{['🥇', '🥈', '🥉'][i]}</span>
              <span className="text-xl">{e.emoji}</span>
              <span className="text-lg font-black text-white truncate flex-1">{e.nome}</span>
              <span className="text-xl font-black text-amber-200 flex items-center gap-1"><Zap size={16} />{e.pontos}</span>
            </div>
          ))}
          {classificacao.slice(3).map(e => (
            <div key={e.uid} className="flex items-center gap-3 py-1 opacity-60">
              <span className="text-sm font-black text-white/55 w-7">{e.posicao}º</span>
              <span className="text-base">{e.emoji}</span>
              <span className="text-sm font-bold text-white truncate flex-1">{e.nome}</span>
              <span className="text-sm font-black text-amber-200">{e.pontos}</span>
            </div>
          ))}
        </div>

        <button onClick={fechar} className="w-full rounded-2xl py-3.5 font-black text-white border-2 mt-2" style={{ background: 'linear-gradient(180deg,#8b6fc4,#6a4f96)', borderColor: '#c9b6e8' }}>
          <Trophy size={18} className="inline mr-2" /> Encerrar a sala
        </button>
      </div>
    </Palco>
  );
}
