import type { Timestamp } from 'firebase/firestore';

// ─────────────────────────────────────────────────────────────────────────────
// Sala do Quiz Relâmpago multijogador: o professor cria, mostra o QR na
// projeção, e cada equipe entra pelo celular. Todos veem a mesma pergunta ao
// mesmo tempo e o professor conduz o ritmo.
// ─────────────────────────────────────────────────────────────────────────────

export type SalaStatus =
  | 'lobby'       // esperando as equipes entrarem
  | 'pergunta'    // pergunta no ar, equipes respondendo
  | 'revelacao'   // resposta certa + explicação + placar; professor avança
  | 'fim';        // pódio

export interface SalaPergunta {
  q: string;
  options: string[];
  correct: number;
  explain?: string;
}

/** Uma linha do placar. Só o aparelho do professor escreve isto. */
export interface PlacarEquipe {
  pontos: number;
  acertos: number;
  streak: number;
  /** Posição na rodada anterior, para mostrar quem subiu e quem caiu. */
  anterior?: number;
}

export interface Sala {
  professorUid: string;
  tema: string;
  status: SalaStatus;
  perguntaAtual: number;
  /** Âncora do cronômetro: gravada pelo servidor a cada nova pergunta. */
  perguntaIniciadaEm: Timestamp | null;
  perguntas: SalaPergunta[];
  placar: Record<string, PlacarEquipe>;
  segundos: number;
  criadaEm: Timestamp | null;
  /**
   * Equipes já cadastradas na turma, copiadas para cá na criação da sala. O
   * aluno não consegue ler a Gamificação do professor (é documento privado
   * dele), então a lista precisa viajar junto com a sala para aparecer como
   * opção de um toque no celular.
   */
  equipesSugeridas?: Equipe[];
}

/** Identidade da equipe. Sem pontuação de propósito — as regras proíbem. */
export interface Equipe {
  nome: string;
  emoji: string;
  cor: string;
  /**
   * Id da equipe cadastrada na Gamificação da turma, quando a equipe entrou
   * escolhendo da lista em vez de digitar um nome novo. É o que permite devolver
   * o XP para as pessoas certas no fim do jogo.
   */
  refId?: string;
}

export interface Resposta {
  pergunta: number;
  equipeUid: string;
  escolha: number;
  em: Timestamp | null;
}

/** Equipe com o placar já casado, pronta para ordenar e desenhar. */
export interface EquipeComPlacar extends Equipe {
  uid: string;
  pontos: number;
  acertos: number;
  streak: number;
  posicao: number;
  anterior?: number;
}
