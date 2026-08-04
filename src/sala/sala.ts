import {
  collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp,
  setDoc, updateDoc, where, getDocs, writeBatch,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '../firebase';
import type { Equipe, EquipeComPlacar, PlacarEquipe, Resposta, Sala, SalaPergunta } from './tipos';

// Alfabeto sem I, O, Q e vogais que confundem: o código é lido em voz alta pelo
// professor e digitado por criança. "PATO" tem que virar PATO, não PAT0.
const ALFABETO = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export const gerarCodigo = (n = 4): string =>
  Array.from({ length: n }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join('');

/**
 * Entra com login anônimo, mas SÓ se ninguém estiver logado. Um professor que
 * abre o link da própria sala no mesmo navegador não pode ser deslogado da
 * conta Google dele por causa disso.
 */
export const garantirLogin = async (): Promise<string> => {
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
};

export const salaRef = (codigo: string) => doc(db, 'salas', codigo);
const equipesRef = (codigo: string) => collection(db, 'salas', codigo, 'equipes');
const respostasRef = (codigo: string) => collection(db, 'salas', codigo, 'respostas');

/**
 * Cria a sala com um código livre. Se dois professores sortearem o mesmo código
 * no mesmo instante, o segundo esbarra nas regras (só o dono atualiza a sala) e
 * tenta outro — a colisão vira uma nova tentativa, não uma sala roubada.
 */
export const criarSala = async (
  perguntas: SalaPergunta[],
  tema: string,
  segundos: number,
  equipesSugeridas: Equipe[] = [],
): Promise<string> => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('sem professor logado');
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const codigo = gerarCodigo();
    const existente = await getDoc(salaRef(codigo));
    if (existente.exists()) continue;
    const sala: Omit<Sala, 'criadaEm' | 'perguntaIniciadaEm'> = {
      professorUid: uid,
      tema,
      status: 'lobby',
      perguntaAtual: 0,
      perguntas,
      placar: {},
      segundos,
      ...(equipesSugeridas.length ? { equipesSugeridas } : {}),
    };
    try {
      await setDoc(salaRef(codigo), { ...sala, criadaEm: serverTimestamp(), perguntaIniciadaEm: null });
      return codigo;
    } catch { /* colidiu com sala de outro professor — sorteia de novo */ }
  }
  throw new Error('não consegui criar a sala');
};

/** Link que vai no QR. O app roteia por `#sala=CODIGO`. */
export const salaUrl = (codigo: string, origin?: string): string => {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');
  return `${base}#sala=${codigo}`;
};

export const lerSala = async (codigo: string): Promise<Sala | null> => {
  const snap = await getDoc(salaRef(codigo));
  return snap.exists() ? (snap.data() as Sala) : null;
};

/**
 * Escuta a sala. `serverTimestamps: 'estimate'` importa: sem isso o
 * `perguntaIniciadaEm` chega null no primeiro snapshot (enquanto o servidor não
 * confirma) e o cronômetro pisca zerado no rosto da turma.
 */
export const ouvirSala = (codigo: string, cb: (s: Sala | null) => void) =>
  onSnapshot(salaRef(codigo), snap =>
    cb(snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) as Sala) : null));

export const ouvirEquipes = (codigo: string, cb: (e: Record<string, Equipe>) => void) =>
  onSnapshot(equipesRef(codigo), snap => {
    const mapa: Record<string, Equipe> = {};
    snap.forEach(d => { mapa[d.id] = d.data() as Equipe; });
    cb(mapa);
  });

/** Respostas de UMA pergunta — é o que diz ao professor quantos já responderam. */
export const ouvirRespostas = (codigo: string, pergunta: number, cb: (r: Resposta[]) => void) =>
  onSnapshot(query(respostasRef(codigo), where('pergunta', '==', pergunta)), snap => {
    const lista: Resposta[] = [];
    snap.forEach(d => lista.push(d.data({ serverTimestamps: 'estimate' }) as Resposta));
    cb(lista);
  });

export const entrarNaSala = async (codigo: string, equipe: Equipe): Promise<string> => {
  const uid = await garantirLogin();
  await setDoc(doc(equipesRef(codigo), uid), equipe);
  return uid;
};

/** A equipe some da sala. As regras deixam cada uma apagar só a si mesma. */
export const sairDaSala = async (codigo: string, uid: string) => {
  await deleteDoc(doc(equipesRef(codigo), uid)).catch(() => {});
};

/**
 * Grava a resposta. O `em` é serverTimestamp porque as regras exigem que seja o
 * relógio do servidor: a pontuação premia rapidez, então deixar o celular do
 * aluno declarar o horário seria entregar o jogo.
 */
export const responder = async (codigo: string, pergunta: number, escolha: number) => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('sem login');
  await setDoc(doc(respostasRef(codigo), `${pergunta}_${uid}`), {
    pergunta, equipeUid: uid, escolha, em: serverTimestamp(),
  });
};

// ── Comandos do professor ────────────────────────────────────────────────────

export const iniciarPergunta = (codigo: string, indice: number) =>
  updateDoc(salaRef(codigo), {
    status: 'pergunta',
    perguntaAtual: indice,
    perguntaIniciadaEm: serverTimestamp(),
  });

export const revelar = (codigo: string, placar: Record<string, PlacarEquipe>) =>
  updateDoc(salaRef(codigo), { status: 'revelacao', placar });

export const encerrar = (codigo: string, placar: Record<string, PlacarEquipe>) =>
  updateDoc(salaRef(codigo), { status: 'fim', placar });

/** Limpa as respostas ao fechar a sala, para não deixar lixo no Firestore. */
export const limparRespostas = async (codigo: string) => {
  const snap = await getDocs(respostasRef(codigo));
  if (snap.empty) return;
  const lote = writeBatch(db);
  snap.forEach(d => lote.delete(d.ref));
  await lote.commit();
};

// ── Pontuação ────────────────────────────────────────────────────────────────

export const PONTO_BASE = 100;
export const PONTO_RAPIDEZ = 100;
export const PONTO_COMBO = 50;
export const COMBO_TETO = 4;

/**
 * Calcula o placar da rodada. Roda só no aparelho do professor: nenhum celular
 * de aluno escreve pontuação, então isto é a única fonte de verdade.
 *
 * O tempo vem da diferença entre dois carimbos do servidor (o início da pergunta
 * e a chegada da resposta), nunca do relógio de quem respondeu.
 */
export const calcularPlacar = (
  placarAtual: Record<string, PlacarEquipe>,
  respostas: Resposta[],
  equipes: Record<string, Equipe>,
  correta: number,
  iniciadaEmMs: number,
  segundos: number,
): Record<string, PlacarEquipe> => {
  const ordemAntes = ordenar(equipes, placarAtual).map(e => e.uid);
  const novo: Record<string, PlacarEquipe> = {};

  for (const uid of Object.keys(equipes)) {
    const antes = placarAtual[uid] ?? { pontos: 0, acertos: 0, streak: 0 };
    const resposta = respostas.find(r => r.equipeUid === uid);
    const acertou = !!resposta && resposta.escolha === correta;

    let ganho = 0;
    let streak = 0;
    if (acertou) {
      const emMs = resposta!.em ? resposta!.em.toMillis() : iniciadaEmMs + segundos * 1000;
      const gasto = Math.max(0, Math.min(segundos * 1000, emMs - iniciadaEmMs));
      const rapidez = Math.round(PONTO_RAPIDEZ * (1 - gasto / (segundos * 1000)));
      streak = antes.streak + 1;
      const combo = streak >= 2 ? PONTO_COMBO * Math.min(streak - 1, COMBO_TETO) : 0;
      ganho = PONTO_BASE + rapidez + combo;
    }

    novo[uid] = {
      pontos: antes.pontos + ganho,
      acertos: antes.acertos + (acertou ? 1 : 0),
      streak,
      anterior: ordemAntes.indexOf(uid) + 1 || undefined,
    };
  }
  return novo;
};

/** Ordena por pontos (desempate por acertos e depois pelo nome, para ser estável). */
export const ordenar = (
  equipes: Record<string, Equipe>,
  placar: Record<string, PlacarEquipe>,
): EquipeComPlacar[] =>
  Object.entries(equipes)
    .map(([uid, e]) => ({
      uid, ...e,
      pontos: placar[uid]?.pontos ?? 0,
      acertos: placar[uid]?.acertos ?? 0,
      streak: placar[uid]?.streak ?? 0,
      anterior: placar[uid]?.anterior,
      posicao: 0,
    }))
    .sort((a, b) => b.pontos - a.pontos || b.acertos - a.acertos || a.nome.localeCompare(b.nome))
    .map((e, i) => ({ ...e, posicao: i + 1 }));
