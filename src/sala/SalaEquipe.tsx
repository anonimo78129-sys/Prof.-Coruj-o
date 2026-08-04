import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, X, Zap, Flame, Trophy, Users } from 'lucide-react';
import { entrarNaSala, garantirLogin, ouvirEquipes, ouvirSala, ordenar, responder } from './sala';
import type { Equipe, Sala } from './tipos';

// Cores das letras — as MESMAS do Quiz Relâmpago na tela do professor, para a
// equipe casar o botão do celular com o que está na projeção sem ler nada.
const CORES = ['#dc4b4b', '#e0ab2e', '#3fae6c', '#3d7fd6'];
const EMOJIS = ['🚀', '🦁', '⚡', '🐉', '🦅', '🔥', '🌟', '🐺', '🦈', '👑', '🎯', '🍀'];

/**
 * Tela do celular da equipe. Entra por `#sala=CODIGO`, faz login anônimo e
 * segue o que a sala mandar — quem conduz o ritmo é o aparelho do professor.
 */
export default function SalaEquipe({ codigo, onSair }: { codigo: string; onSair: () => void }) {
  const [uid, setUid] = useState<string | null>(null);
  const [sala, setSala] = useState<Sala | null>(null);
  const [equipes, setEquipes] = useState<Record<string, Equipe>>({});
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [nome, setNome] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [escolha, setEscolha] = useState<number | null>(null);
  const perguntaAnterior = useRef(-1);

  useEffect(() => {
    let vivo = true;
    garantirLogin()
      .then(u => { if (vivo) setUid(u); })
      .catch(() => { if (vivo) setErro('Não consegui entrar. Tente abrir o link de novo.'); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!uid) return;
    const un1 = ouvirSala(codigo, s => { setSala(s); if (!s) setErro('Sala não encontrada. Confira o código com o professor.'); });
    const un2 = ouvirEquipes(codigo, setEquipes);
    return () => { un1(); un2(); };
  }, [codigo, uid]);

  // Pergunta nova: limpa a escolha anterior. Fica no ref porque o snapshot da
  // sala chega várias vezes por pergunta e não pode zerar o que já foi marcado.
  useEffect(() => {
    if (!sala) return;
    if (sala.perguntaAtual !== perguntaAnterior.current) {
      perguntaAnterior.current = sala.perguntaAtual;
      setEscolha(null);
    }
  }, [sala]);

  const minhaEquipe = uid ? equipes[uid] : undefined;
  const jaEntrou = !!minhaEquipe?.nome;
  const pergunta = sala?.perguntas?.[sala.perguntaAtual];
  const classificacao = useMemo(() => ordenar(equipes, sala?.placar ?? {}), [equipes, sala?.placar]);
  const minhaLinha = classificacao.find(e => e.uid === uid);

  const entrar = async () => {
    const limpo = nome.trim();
    if (!limpo) { setErro('Digite o nome da equipe.'); return; }
    setErro(''); setEntrando(true);
    try {
      await entrarNaSala(codigo, { nome: limpo.slice(0, 22), emoji, cor: CORES[Math.floor(Math.random() * CORES.length)] });
    } catch { setErro('Não consegui entrar na sala. Tente de novo.'); }
    setEntrando(false);
  };

  const marcar = async (i: number) => {
    if (escolha !== null || sala?.status !== 'pergunta') return;
    setEscolha(i);
    try { await responder(codigo, sala.perguntaAtual, i); }
    catch { setEscolha(null); setErro('A resposta não foi. Tente de novo.'); }
  };

  const Palco = ({ children }: { children: React.ReactNode }) => (
    <div className="fixed inset-0 z-[120] flex flex-col overflow-y-auto" style={{ background: 'linear-gradient(180deg,#345b86,#1b3050)' }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <span className="text-[10px] font-black tracking-[0.2em] text-white/45">SALA {codigo}</span>
        <button onClick={onSair} aria-label="Sair" className="w-9 h-9 rounded-full bg-black/30 flex items-center justify-center text-white/80">
          <X size={17} />
        </button>
      </div>
      <div className="flex-1 flex flex-col px-5 pb-8">{children}</div>
    </div>
  );

  if (!uid) return <Palco><div className="flex-1 flex items-center justify-center"><Loader2 size={30} className="text-white/70 animate-spin" /></div></Palco>;

  // ── Ainda não escolheu a equipe ────────────────────────────────────────────
  if (!jaEntrou) {
    const sugeridas = (sala as any)?.equipesSugeridas as Equipe[] | undefined;
    const ocupados = new Set(Object.values(equipes).map(e => e.nome));
    return (
      <Palco>
        <div className="flex-1 flex flex-col justify-center gap-5 max-w-sm mx-auto w-full py-6">
          <div className="text-center">
            <p className="text-5xl mb-2">⚡</p>
            <h1 className="text-2xl font-black text-white">Quiz Relâmpago</h1>
            {sala?.tema && <p className="text-indigo-100/70 text-sm mt-1">{sala.tema}</p>}
          </div>

          {sugeridas?.length ? (
            <div>
              <p className="text-[11px] font-bold text-indigo-200/80 tracking-wide mb-2">QUAL É A SUA EQUIPE?</p>
              <div className="grid grid-cols-2 gap-2">
                {sugeridas.map((s, i) => {
                  const tomada = ocupados.has(s.nome);
                  return (
                    <button
                      key={i}
                      disabled={tomada}
                      onClick={() => { setNome(s.nome); setEmoji(s.emoji || EMOJIS[i % EMOJIS.length]); }}
                      className="rounded-2xl px-3 py-3 border-2 text-left active:scale-95 transition disabled:opacity-35"
                      style={{ background: nome === s.nome ? 'rgba(183,154,240,0.3)' : 'rgba(255,255,255,0.08)', borderColor: nome === s.nome ? '#c9b6e8' : 'rgba(255,255,255,0.15)' }}
                    >
                      <span className="text-xl block">{s.emoji || '⭐'}</span>
                      <span className="text-xs font-bold text-white block truncate">{s.nome}</span>
                      {tomada && <span className="text-[9px] text-white/50">já entrou</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-[11px] font-bold text-indigo-200/80 tracking-wide mb-2">
              {sugeridas?.length ? 'OU DIGITE OUTRO NOME' : 'NOME DA EQUIPE'}
            </p>
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') entrar(); }}
              placeholder="Ex.: Os Foguetes"
              maxLength={22}
              className="w-full rounded-2xl px-4 py-3 text-base font-bold text-[#2f2148] bg-[#f3eefb] outline-none focus:ring-2 focus:ring-[#b79af0]"
            />
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className="w-10 h-10 rounded-xl text-xl flex items-center justify-center border-2 active:scale-90 transition"
                  style={{ background: emoji === e ? 'rgba(183,154,240,0.35)' : 'rgba(255,255,255,0.08)', borderColor: emoji === e ? '#c9b6e8' : 'transparent' }}
                >{e}</button>
              ))}
            </div>
          </div>

          {erro && <p className="text-rose-300 text-xs font-semibold text-center">{erro}</p>}

          <button
            onClick={entrar}
            disabled={entrando}
            className="w-full rounded-2xl py-4 font-black text-white text-lg border-2 shadow-xl active:scale-[0.98] transition disabled:opacity-60"
            style={{ background: 'linear-gradient(180deg,#8b6fc4,#6a4f96)', borderColor: '#c9b6e8' }}
          >
            {entrando ? <Loader2 size={20} className="inline animate-spin" /> : <>{emoji} Entrar no jogo</>}
          </button>
        </div>
      </Palco>
    );
  }

  // ── Já entrou: segue o que a sala manda ────────────────────────────────────
  const cabecalho = (
    <div className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2 mb-4 shrink-0" style={{ background: 'rgba(0,0,0,0.28)' }}>
      <span className="font-black text-white text-sm truncate">{minhaEquipe!.emoji} {minhaEquipe!.nome}</span>
      <span className="flex items-center gap-2 shrink-0">
        {!!minhaLinha?.streak && minhaLinha.streak >= 2 && (
          <span className="flex items-center gap-0.5 text-[11px] font-black text-orange-300"><Flame size={12} />{minhaLinha.streak}</span>
        )}
        <span className="flex items-center gap-1 text-[11px] font-black text-amber-200"><Zap size={12} />{minhaLinha?.pontos ?? 0}</span>
        {!!minhaLinha && <span className="text-[11px] font-black text-white/70">{minhaLinha.posicao}º</span>}
      </span>
    </div>
  );

  if (sala?.status === 'lobby') {
    return (
      <Palco>
        {cabecalho}
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <Check size={44} className="text-emerald-300" />
          <p className="text-white font-black text-xl">Você está dentro!</p>
          <p className="text-indigo-100/70 text-sm max-w-xs">Espere o professor começar. Fique de olho na tela da sala.</p>
          <p className="flex items-center gap-1.5 text-indigo-100/50 text-xs mt-2">
            <Users size={13} /> {Object.keys(equipes).length} equipe(s) na sala
          </p>
        </div>
      </Palco>
    );
  }

  if (sala?.status === 'pergunta' && pergunta) {
    const respondeu = escolha !== null;
    return (
      <Palco>
        {cabecalho}
        <p className="text-[10px] font-black tracking-widest text-indigo-200/60 mb-1.5">
          PERGUNTA {sala.perguntaAtual + 1} DE {sala.perguntas.length}
        </p>
        <div className="rounded-2xl p-4 mb-4 bg-[#f7efdc] shadow-xl">
          <p className="font-extrabold text-[#3a2413] text-base leading-snug">{pergunta.q}</p>
        </div>

        {respondeu ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl font-black text-white shadow-2xl" style={{ background: CORES[escolha!] }}>
              {String.fromCharCode(65 + escolha!)}
            </div>
            <p className="text-white font-black text-lg">Resposta enviada!</p>
            <p className="text-indigo-100/60 text-sm">Aguarde as outras equipes.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {pergunta.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => marcar(i)}
                className="w-full rounded-2xl px-4 py-4 flex items-center gap-3 text-left border-[3px] border-white/85 shadow-lg active:scale-[0.97] transition"
                style={{ background: CORES[i] }}
              >
                <span className="w-9 h-9 rounded-xl bg-white/25 flex items-center justify-center text-white font-black text-lg shrink-0">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-white font-bold text-base leading-snug break-words min-w-0">{opt}</span>
              </button>
            ))}
          </div>
        )}
      </Palco>
    );
  }

  if (sala?.status === 'revelacao' && pergunta) {
    const acertou = escolha !== null && escolha === pergunta.correct;
    return (
      <Palco>
        {cabecalho}
        <div className="flex-1 flex flex-col justify-center gap-4">
          <div className="text-center">
            <p className="text-6xl mb-2">{acertou ? '🎉' : escolha === null ? '⏱️' : '😕'}</p>
            <p className="font-black text-2xl" style={{ color: acertou ? '#7bf0a6' : '#ff9a9a' }}>
              {acertou ? 'Acertou!' : escolha === null ? 'Não deu tempo' : 'Dessa vez não'}
            </p>
          </div>
          <div className="rounded-2xl px-4 py-3 border-2" style={{ background: 'rgba(0,0,0,0.28)', borderColor: 'rgba(123,240,166,0.45)' }}>
            <p className="text-[10px] font-black tracking-widest text-emerald-300 mb-1">RESPOSTA CERTA</p>
            <p className="text-white font-bold text-sm">
              {String.fromCharCode(65 + pergunta.correct)}) {pergunta.options[pergunta.correct]}
            </p>
            {pergunta.explain && <p className="text-white/75 text-sm mt-2 leading-relaxed">{pergunta.explain}</p>}
          </div>
          <div className="rounded-2xl p-3" style={{ background: 'rgba(0,0,0,0.28)' }}>
            <p className="text-[10px] font-black tracking-widest text-indigo-200/60 mb-2">PLACAR</p>
            {classificacao.slice(0, 5).map(e => (
              <div key={e.uid} className={`flex items-center gap-2 py-1 ${e.uid === uid ? 'opacity-100' : 'opacity-65'}`}>
                <span className="text-xs font-black text-white/60 w-5">{e.posicao}º</span>
                <span className="text-sm">{e.emoji}</span>
                <span className="text-sm font-bold text-white truncate flex-1">{e.nome}</span>
                <span className="text-sm font-black text-amber-200">{e.pontos}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-indigo-100/45 text-xs">O professor vai passar para a próxima.</p>
        </div>
      </Palco>
    );
  }

  if (sala?.status === 'fim') {
    const eu = minhaLinha;
    const medalha = eu?.posicao === 1 ? '🥇' : eu?.posicao === 2 ? '🥈' : eu?.posicao === 3 ? '🥉' : '🦉';
    return (
      <Palco>
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-7xl">{medalha}</p>
          <p className="text-white font-black text-2xl">{eu?.posicao}º lugar</p>
          <p className="text-amber-200 font-black text-3xl flex items-center gap-1.5"><Zap size={24} />{eu?.pontos ?? 0}</p>
          <p className="text-indigo-100/70 text-sm">{eu?.acertos ?? 0} de {sala.perguntas.length} acertos</p>
          <div className="w-full max-w-xs rounded-2xl p-3 mt-3" style={{ background: 'rgba(0,0,0,0.28)' }}>
            {classificacao.map(e => (
              <div key={e.uid} className={`flex items-center gap-2 py-1 ${e.uid === uid ? '' : 'opacity-60'}`}>
                <span className="text-xs font-black text-white/60 w-5">{e.posicao}º</span>
                <span className="text-sm">{e.emoji}</span>
                <span className="text-sm font-bold text-white truncate flex-1 text-left">{e.nome}</span>
                <span className="text-sm font-black text-amber-200">{e.pontos}</span>
              </div>
            ))}
          </div>
          <button onClick={onSair} className="mt-4 rounded-2xl px-6 py-3 font-black text-white border-2" style={{ background: 'linear-gradient(180deg,#8b6fc4,#6a4f96)', borderColor: '#c9b6e8' }}>
            <Trophy size={16} className="inline mr-1.5" /> Sair
          </button>
        </div>
      </Palco>
    );
  }

  return (
    <Palco>
      {cabecalho}
      <div className="flex-1 flex items-center justify-center">
        {erro ? <p className="text-rose-300 text-sm font-semibold text-center">{erro}</p>
              : <Loader2 size={28} className="text-white/70 animate-spin" />}
      </div>
    </Palco>
  );
}
