// Consulta às aprendizagens da BNCC.
//
// Os dados vivem em `bncc-dataset.ts` (gerado, 1.580 registros oficiais) e são
// carregados sob demanda: o arquivo tem ~364 KB e não deve entrar no primeiro
// carregamento do app.

import type { BnccRow } from './bncc-dataset';

export interface BnccSkill {
  code: string;
  desc: string;
}

export type Etapa = 'infantil' | 'fundamental' | 'medio';

export interface BnccContext {
  etapa: Etapa | null;
  /** Ano do Ensino Fundamental (1–9), quando identificado. */
  ano?: number;
  /** Grupo etário da Educação Infantil (1 = bebês, 2 = bem pequenas, 3 = pequenas). */
  grupo?: number;
}

// ── Carregamento sob demanda ────────────────────────────────────────────────
let rowsCache: readonly BnccRow[] | null = null;

/** Carrega (uma única vez) o dataset completo da BNCC. */
export const loadBnccRows = async (): Promise<readonly BnccRow[]> => {
  if (!rowsCache) {
    const mod = await import('./bncc-dataset');
    rowsCache = mod.BNCC_ROWS;
  }
  return rowsCache;
};

// ── Normalização ────────────────────────────────────────────────────────────
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ── Disciplina → componente/área da BNCC ────────────────────────────────────
// `ef` e `em` guardam os códigos de componente usados no dataset em cada etapa.
// Uma disciplina pode não existir numa etapa (Ensino Religioso não tem médio).
interface SubjectMap {
  names: string[];
  ef?: string[];
  em?: string[];
}

const SUBJECT_MAP: SubjectMap[] = [
  { names: ['lingua portuguesa', 'portugues', 'lp', 'redacao', 'literatura'], ef: ['lp'], em: ['lp', 'lgg'] },
  { names: ['matematica', 'mat', 'ma'],                                       ef: ['ma'], em: ['mat'] },
  { names: ['ciencias', 'ciencias da natureza', 'ci'],                        ef: ['ci'], em: ['cnt'] },
  { names: ['historia', 'hi'],                                                ef: ['hi'], em: ['chs'] },
  { names: ['geografia', 'geo', 'ge'],                                        ef: ['ge'], em: ['chs'] },
  { names: ['arte', 'artes', 'ar', 'educacao artistica'],                     ef: ['ar'], em: ['lgg'] },
  { names: ['educacao fisica', 'ed fisica', 'edf'],                           ef: ['ef'], em: ['lgg'] },
  { names: ['ensino religioso', 'religiao', 'er'],                            ef: ['er'] },
  { names: ['lingua inglesa', 'ingles', 'li'],                                ef: ['li'], em: ['lgg'] },
  { names: ['lingua espanhola', 'espanhol'],                                              em: ['lgg'] },
  { names: ['fisica'],                                                        ef: ['ci'], em: ['cnt'] },
  { names: ['quimica'],                                                       ef: ['ci'], em: ['cnt'] },
  { names: ['biologia'],                                                      ef: ['ci'], em: ['cnt'] },
  { names: ['sociologia'],                                                                em: ['chs'] },
  { names: ['filosofia'],                                                                 em: ['chs'] },
];

/**
 * Quão bem o nome digitado casa com um nome conhecido.
 * 3 = igual · 2 = nome composto contido · 1 = apelido como palavra inteira
 *
 * O casamento por palavra inteira evita que o apelido "ci" de Ciências case
 * dentro de "soCIologia", ou "bio" dentro de "astrobiologia".
 */
const subjectMatchScore = (normSubject: string, names: string[]): number => {
  const words = normSubject.split(/\s+/).filter(Boolean);
  let best = 0;
  for (const name of names) {
    const n = norm(name);
    if (n === normSubject) return 3;
    if (n.includes(' ') && normSubject.includes(n)) best = Math.max(best, 2);
    else if (words.includes(n)) best = Math.max(best, 1);
  }
  return best;
};

const findSubject = (subject: string): SubjectMap | undefined => {
  const normSubject = norm(subject);
  if (!normSubject) return undefined;
  let found: SubjectMap | undefined;
  let bestScore = 0;
  for (const candidate of SUBJECT_MAP) {
    const score = subjectMatchScore(normSubject, candidate.names);
    if (score > bestScore) { bestScore = score; found = candidate; }
  }
  return found;
};

// ── Detecção de etapa e ano ─────────────────────────────────────────────────
const ORDINAL_EXTENSO: Record<string, number> = {
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, quinto: 5,
  sexto: 6, setimo: 7, oitavo: 8, nono: 9,
};

/**
 * Descobre etapa, ano e grupo etário a partir do nível cadastrado da turma e
 * do nome dela.
 *
 * O nível é a fonte confiável e vem primeiro. O nome é o plano B e precisa
 * aceitar como as escolas realmente nomeiam: "9º B", "3º A", "2ª série" — não
 * só "9º ano".
 */
export const detectBnccContext = (className: string, level?: string): BnccContext => {
  const s = `${norm(level || '')} ${norm(className)}`.trim();

  // Educação Infantil
  if (/infantil|creche|bercario|maternal|pre-?escola|jardim/.test(s)) {
    const grupo =
      /bercario|bebe/.test(s)   ? 1 :
      /maternal/.test(s)        ? 2 :
      /pre-?escola|jardim/.test(s) ? 3 : undefined;
    return { etapa: 'infantil', grupo };
  }

  // Ensino Médio — "médio", "1ª série", "2a serie"
  if (/ensino medio|\bmedio\b|[1-3]\s*[ª°º]?\s*serie/.test(s)) {
    return { etapa: 'medio' };
  }

  // Ensino Fundamental — o ordinal basta, sem exigir a palavra "ano"
  const ordinal = s.match(/\b([1-9])\s*[°ºª]/) || s.match(/\b([1-9])\s*ano\b/);
  if (ordinal) return { etapa: 'fundamental', ano: Number(ordinal[1]) };

  for (const [palavra, digito] of Object.entries(ORDINAL_EXTENSO)) {
    if (new RegExp(`\\b${palavra}\\b`).test(s)) return { etapa: 'fundamental', ano: digito };
  }

  if (/fundamental/.test(s)) return { etapa: 'fundamental' };
  return { etapa: null };
};

// ── Relevância temática ─────────────────────────────────────────────────────
// Sem etiquetas curadas: a pontuação vem do próprio texto oficial da habilidade.
const STOPWORDS = new Set([
  'para', 'como', 'sobre', 'entre', 'pelo', 'pela', 'dos', 'das', 'com', 'que',
  'uma', 'seus', 'suas', 'aula', 'aulas', 'sua', 'seu', 'este', 'esta', 'nos',
]);

const topicTokens = (topic: string): string[] =>
  norm(topic).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOPWORDS.has(w));

/** Raiz curta da palavra: casa "célula" com "celulares"? Não — só plural/gênero. */
const stem = (w: string) => w.replace(/(coes|oes|ais|eis|ens|s)$/, '');

const scoreRow = (desc: string, tokens: string[]): number => {
  if (tokens.length === 0) return 0;
  const normDesc = norm(desc);
  let score = 0;
  for (const token of tokens) {
    if (normDesc.includes(token)) { score += 2; continue; }
    const raiz = stem(token);
    if (raiz.length > 3 && normDesc.includes(raiz)) score += 1;
  }
  return score;
};

// ── Seleção ─────────────────────────────────────────────────────────────────
const rowMatchesContext = (row: BnccRow, ctx: BnccContext, comps: string[] | undefined): boolean => {
  const [code, , comp, anos] = row;

  if (ctx.etapa === 'infantil') {
    if (!code.startsWith('EI')) return false;
    if (!ctx.grupo) return true;                       // grupo indefinido: aceita todos
    return code.slice(2, 4) === String(ctx.grupo).padStart(2, '0');
  }

  if (!comps || !comps.includes(comp)) return false;

  if (ctx.etapa === 'medio')       return code.startsWith('EM');
  if (ctx.etapa === 'fundamental') {
    if (!code.startsWith('EF')) return false;
    if (!ctx.ano) return true;                          // etapa sem ano: aceita todos
    return !anos || anos.includes(ctx.ano);
  }
  return false;
};

/**
 * Seleciona as aprendizagens da BNCC mais relevantes para a combinação
 * disciplina + turma + tópico.
 *
 * Devolve lista vazia quando a etapa não pode ser inferida ou a disciplina não
 * existe naquela etapa. Ancorar na etapa errada é pior que não ancorar: o plano
 * sai com código real da série errada, e a validação determinística o congela lá.
 */
export const selectBnccSkills = async (
  subject: string,
  className: string,
  topic: string,
  count = 4,
  level?: string,
): Promise<BnccSkill[]> => {
  const ctx = detectBnccContext(className, level);
  if (!ctx.etapa) return [];

  // Na Educação Infantil não há disciplina: os campos de experiência valem para
  // toda a etapa, então a seleção é puramente temática.
  let comps: string[] | undefined;
  if (ctx.etapa !== 'infantil') {
    const found = findSubject(subject);
    if (!found) return [];
    comps = ctx.etapa === 'medio' ? found.em : found.ef;
    if (!comps || comps.length === 0) return [];
  }

  const rows = await loadBnccRows();
  const candidatas = rows.filter(r => rowMatchesContext(r, ctx, comps));
  if (candidatas.length === 0) return [];

  const tokens = topicTokens(topic);
  const scored = candidatas.map(r => ({ row: r, score: scoreRow(r[1], tokens) }));
  // desempate estável pelo código, para o mesmo pedido devolver sempre o mesmo
  scored.sort((a, b) => b.score - a.score || a.row[0].localeCompare(b.row[0]));

  return scored.slice(0, count).map(s => ({ code: s.row[0], desc: s.row[1] }));
};

// ── Opções de disciplina exibidas na interface ──────────────────────────────
export const SUBJECT_OPTIONS = [
  'Língua Portuguesa',
  'Matemática',
  'Ciências',
  'História',
  'Geografia',
  'Arte',
  'Educação Física',
  'Ensino Religioso',
  'Língua Inglesa',
  'Física',
  'Química',
  'Biologia',
  'Sociologia',
  'Filosofia',
  'Outra',
];

// ── Validação determinística das habilidades no plano gerado ─────────────────
// A IA inventa códigos de habilidade que não existem. Em vez de pedir a ela que
// confira o próprio trabalho, conferimos aqui: extraímos os códigos do texto e
// comparamos com as habilidades reais que foram injetadas no comando. Se houver
// código inventado, faltando, ou nenhum código, a seção é reescrita.

// Padrão como string: a expressão global é construída a cada uso para não
// carregar `lastIndex` entre chamadas.
// Formatos oficiais (BNCC/MEC):
//  · Ensino Fundamental — EF + ano OU faixa de anos + componente + sequencial
//    Faixas agrupadas são comuns: EF15LP01 (1º ao 5º), EF67LP01 (6º e 7º),
//    EF12EF01, EF35AR01, EF69CI01, EF89GE01.
//    Componentes: LP MA CI GE HI AR EF ER LI
//  · Ensino Médio — EM13 + área (3 letras) + 3 dígitos: EM13LGG101, EM13MAT101,
//    EM13CNT101, EM13CHS101. E TAMBÉM componente específico com 2 letras e
//    2 dígitos: EM13LP01 (Língua Portuguesa), EM13LI01 (Língua Inglesa).
//  · Educação Infantil — EI + grupo etário (01/02/03) + campo de experiência
//    (EO CG TS EF ET) + sequencial: EI01CG02, EI02EO01, EI03ET05.
// A alternativa de 3 letras vem antes da de 2 para não recortar EM13LGG101.
const BNCC_CODE_SOURCE =
  '\\b(EF\\d{2}[A-Z]{2}\\d{2}|EM13[A-Z]{3}\\d{3}|EM13[A-Z]{2}\\d{2}|EI0[1-3][A-Z]{2}\\d{2})\\b';

/** Todos os códigos BNCC presentes no texto, em maiúsculas e sem repetição. */
export const extractBnccCodes = (text: string): string[] => {
  const found = text.match(new RegExp(BNCC_CODE_SOURCE, 'g')) || [];
  return [...new Set(found.map(c => c.toUpperCase()))];
};

/** Bloco em Markdown com as habilidades verificadas, uma por linha. */
export const formatBnccBlock = (skills: BnccSkill[]): string =>
  skills.map(s => `- ${s.code} — ${s.desc}`).join('\n');

export type BnccValidationReason =
  | 'ok'              // o plano já está correto
  | 'codigo-invalido' // a IA citou código que não existe no banco
  | 'codigo-faltante' // faltou citar alguma habilidade injetada
  | 'sem-codigo'      // o plano não trouxe nenhum código
  | 'secao-ausente';  // a IA nem gerou a seção de habilidades

export interface BnccValidationResult {
  /** Plano corrigido (ou o original, se nada precisou mudar). */
  text: string;
  corrected: boolean;
  reason: BnccValidationReason;
  invalidCodes: string[];
  missingCodes: string[];
}

const BNCC_SECTION_TITLE = '## HABILIDADE (BNCC)';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex da seção a partir do título — a Educação Infantil usa outro título. */
const sectionPattern = (title: string) =>
  new RegExp(`${escapeRegex(title.replace(/^##\s*/, '## '))}[\\s\\S]*?(?=\\n## |\\n---|\\n#[^#]|$)`, 'i');

/**
 * Confere as habilidades BNCC de um plano gerado contra as habilidades reais
 * que foram entregues à IA, e reescreve a seção quando necessário.
 *
 * Quando a seção não existe no plano, ela é acrescentada ao final — antes esse
 * caso passava batido e o plano saía sem nenhuma habilidade.
 */
export const validateBnccSection = (
  planText: string,
  skills: BnccSkill[],
  sectionTitle: string = BNCC_SECTION_TITLE,
): BnccValidationResult => {
  const unchanged: BnccValidationResult = {
    text: planText, corrected: false, reason: 'ok', invalidCodes: [], missingCodes: [],
  };
  // Sem habilidades injetadas (educação infantil, disciplina fora do banco) não
  // há contra o que comparar — devolve o plano como veio.
  if (skills.length === 0) return unchanged;

  const validCodes = new Set(skills.map(s => s.code.toUpperCase()));
  const codesInPlan = extractBnccCodes(planText);

  const invalidCodes = codesInPlan.filter(c => !validCodes.has(c));
  const missingCodes = skills.map(s => s.code.toUpperCase()).filter(c => !codesInPlan.includes(c));

  const pattern = sectionPattern(sectionTitle);
  const hasSection = pattern.test(planText);

  if (invalidCodes.length === 0 && missingCodes.length === 0 && hasSection) return unchanged;

  const correctSection = `${sectionTitle}\n${formatBnccBlock(skills)}`;

  const reason: BnccValidationReason =
    !hasSection            ? 'secao-ausente'
    : invalidCodes.length  ? 'codigo-invalido'
    : missingCodes.length  ? 'codigo-faltante'
    : 'sem-codigo';

  const text = hasSection
    ? planText.replace(pattern, correctSection + '\n')
    : `${planText.replace(/\s+$/, '')}\n\n${correctSection}\n`;

  return { text, corrected: true, reason, invalidCodes, missingCodes };
};
