import { GoogleGenAI, Type } from '@google/genai';
import { resolveApiKey, GEMINI_MODEL } from './gemini';
import { DEFAULT_NARRATIVE_CHOICES } from '../data/narrative';
import type { GameConfig, MCQuestion, MatchPair, NarrativeChoice } from '../types/game';

function uid() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

const questionSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING, description: 'Enunciado da pergunta, claro e didático.' },
    options: {
      type: Type.ARRAY,
      description: 'Exatamente 4 alternativas plausíveis.',
      items: { type: Type.STRING },
    },
    correct: { type: Type.INTEGER, description: 'Índice (0 a 3) da alternativa correta.' },
  },
  required: ['text', 'options', 'correct'],
};

const narrativeSchema = {
  type: Type.OBJECT,
  properties: {
    prompt: { type: Type.STRING, description: 'Pergunta reflexiva ligada ao conteúdo.' },
    options: {
      type: Type.ARRAY,
      description: 'Exatamente 2 opções de escolha.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          karma: { type: Type.STRING, enum: ['luz', 'sombra'] },
          reaction: { type: Type.STRING, description: 'Resposta curta do guardião à escolha.' },
        },
        required: ['label', 'karma', 'reaction'],
      },
    },
  },
  required: ['prompt', 'options'],
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    intro: {
      type: Type.ARRAY,
      description: '4 a 5 falas curtas de abertura que misturam a fantasia do Éter com o conteúdo da disciplina.',
      items: { type: Type.STRING },
    },
    hook: { type: Type.STRING, description: 'Uma frase de missão citando o conteúdo (ex: "Domine X para abrir o Portal").' },
    forestQuestions: { type: Type.ARRAY, description: '3 perguntas de múltipla escolha.', items: questionSchema },
    cityPairs: {
      type: Type.ARRAY,
      description: '4 pares conceito/definição do conteúdo.',
      items: {
        type: Type.OBJECT,
        properties: {
          concept: { type: Type.STRING },
          definition: { type: Type.STRING },
        },
        required: ['concept', 'definition'],
      },
    },
    cavesQuestions: { type: Type.ARRAY, description: '5 perguntas de múltipla escolha.', items: questionSchema },
    towerQuestions: { type: Type.ARRAY, description: '3 perguntas de síntese (mais difíceis).', items: questionSchema },
    forestChoice: narrativeSchema,
    cityChoice: narrativeSchema,
    cavesChoice: narrativeSchema,
  },
  required: ['intro', 'hook', 'forestQuestions', 'cityPairs', 'cavesQuestions', 'towerQuestions', 'forestChoice', 'cityChoice', 'cavesChoice'],
};

function buildPrompt(subject: string, level: string, instructions?: string): string {
  let prompt = `Você é um designer de jogos educativos. Crie o CONTEÚDO de um RPG de aventura em português do Brasil.

CONTEÚDO/DISCIPLINA: "${subject}"
NÍVEL DOS ALUNOS: "${level || 'Ensino Fundamental'}"

O jogo é um molde pronto com fases e mecânicas diferentes. Seu trabalho é preencher TODAS as partes
com conteúdo correto e didático sobre o tema, no nível indicado, para que o aluno APRENDA jogando.

Regras OBRIGATÓRIAS:
- Tudo em português do Brasil, linguagem adequada ao nível dos alunos.
- Perguntas de múltipla escolha: SEMPRE 4 alternativas, apenas 1 correta, com "correct" indicando o índice (0-3).
  Os distratores devem ser plausíveis (erros comuns), não absurdos.
- As perguntas devem ENSINAR o conteúdo "${subject}", progredindo de mais fáceis (floresta) a síntese (torre).
- cityPairs: 4 pares ligando um conceito do tema à sua definição/exemplo correto.
- As escolhas narrativas (forestChoice, cityChoice, cavesChoice) devem ser reflexões ligadas ao tema,
  com 2 opções (uma karma "luz", outra "sombra") e uma reação curta para cada.
- intro: 4 a 5 falas curtas que conectam a história de fantasia (um portal mágico, o mundo "Éter")
  ao tema "${subject}", deixando claro que dominar o conteúdo é a chave para vencer.
- Seja factualmente correto. Não invente fatos sobre o tema.`;
  if (instructions?.trim()) {
    prompt += `\n\nINSTRUÇÕES ADICIONAIS DO PROFESSOR:\n${instructions.trim()}`;
  }
  return prompt;
}

function normQuestions(raw: unknown, count: number): MCQuestion[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: MCQuestion[] = [];
  for (const item of arr) {
    const r = item as { text?: string; options?: string[]; correct?: number };
    const text = (r.text ?? '').trim();
    let options = (r.options ?? []).map(o => String(o ?? '').trim()).filter(Boolean);
    if (!text || options.length < 2) continue;
    while (options.length < 4) options.push('—');
    options = options.slice(0, 4);
    let correct = Number.isInteger(r.correct) ? (r.correct as number) : 0;
    if (correct < 0 || correct > 3) correct = 0;
    out.push({ text, options: options as [string, string, string, string], correct: correct as 0 | 1 | 2 | 3 });
  }
  return out.slice(0, count);
}

function normPairs(raw: unknown, count: number): MatchPair[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: MatchPair[] = [];
  for (const item of arr) {
    const r = item as { concept?: string; definition?: string };
    const concept = (r.concept ?? '').trim();
    const definition = (r.definition ?? '').trim();
    if (concept && definition) out.push({ concept, definition });
  }
  return out.slice(0, count);
}

function normChoice(raw: unknown, fallback: NarrativeChoice): NarrativeChoice {
  const r = raw as { prompt?: string; options?: Array<{ label?: string; karma?: string; reaction?: string }> };
  const prompt = (r?.prompt ?? '').trim();
  const opts = Array.isArray(r?.options) ? r!.options! : [];
  const mapped = opts
    .map(o => ({
      label: (o.label ?? '').trim(),
      karma: (o.karma === 'sombra' ? 'sombra' : 'luz') as 'luz' | 'sombra',
      reaction: (o.reaction ?? '').trim(),
    }))
    .filter(o => o.label && o.reaction);
  if (!prompt || mapped.length < 2) return fallback;
  // garante uma luz e uma sombra
  const luz = mapped.find(o => o.karma === 'luz') ?? { ...mapped[0], karma: 'luz' as const };
  const sombra = mapped.find(o => o.karma === 'sombra') ?? { ...mapped[1], karma: 'sombra' as const };
  return { prompt, options: [luz, sombra] };
}

export interface GenerationResult {
  config: GameConfig;
  warnings: string[];
}

export async function generateGame(subject: string, level: string, instructions?: string): Promise<GenerationResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildPrompt(subject, level, instructions),
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.85,
    },
  });

  const text = response.text ?? '';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('PARSE_ERROR');
  }

  const warnings: string[] = [];
  const forestQuestions = normQuestions(data.forestQuestions, 3);
  const cityPairs = normPairs(data.cityPairs, 4);
  const cavesQuestions = normQuestions(data.cavesQuestions, 5);
  const towerQuestions = normQuestions(data.towerQuestions, 3);

  if (forestQuestions.length < 3) warnings.push('Floresta veio com menos de 3 perguntas.');
  if (cityPairs.length < 4) warnings.push('Cidade veio com menos de 4 pares.');
  if (cavesQuestions.length < 5) warnings.push('Cavernas veio com menos de 5 perguntas.');
  if (towerQuestions.length < 3) warnings.push('Torre veio com menos de 3 perguntas.');

  const introRaw = Array.isArray(data.intro) ? (data.intro as unknown[]).map(s => String(s).trim()).filter(Boolean) : [];
  const hook = String(data.hook ?? '').trim();

  const config: GameConfig = {
    id: uid(),
    subject: subject.trim(),
    level: level.trim() || undefined,
    createdAt: Date.now(),
    story: introRaw.length ? { intro: introRaw.slice(0, 6), hook } : undefined,
    scenes: {
      forest: { questions: forestQuestions, narrative: normChoice(data.forestChoice, DEFAULT_NARRATIVE_CHOICES.forest) },
      city: { pairs: cityPairs, narrative: normChoice(data.cityChoice, DEFAULT_NARRATIVE_CHOICES.city) },
      caves: { questions: cavesQuestions, narrative: normChoice(data.cavesChoice, DEFAULT_NARRATIVE_CHOICES.caves) },
      tower: { questions: towerQuestions },
    },
    assets: {},
  };

  return { config, warnings };
}

export async function regenerateQuestion(
  subject: string,
  level: string,
  bank: 'forest' | 'caves' | 'tower',
): Promise<MCQuestion> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const client = new GoogleGenAI({ apiKey });

  const bankNames = { forest: 'floresta (fácil)', caves: 'cavernas (médio)', tower: 'torre (síntese/difícil)' };
  const prompt = `Crie UMA pergunta de múltipla escolha sobre "${subject}", nível "${level || 'Ensino Fundamental'}".
Banco: ${bankNames[bank]}.
Regras: 4 alternativas plausíveis, apenas 1 correta (índice 0–3), factualmente correta, português do Brasil.`;

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: questionSchema, temperature: 0.9 },
  });

  const text = response.text ?? '';
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('PARSE_ERROR'); }
  const results = normQuestions([data], 1);
  if (!results.length) throw new Error('PARSE_ERROR');
  return results[0];
}

export async function regeneratePair(
  subject: string,
  level: string,
): Promise<MatchPair> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const client = new GoogleGenAI({ apiKey });

  const pairSchema = {
    type: Type.OBJECT,
    properties: {
      concept: { type: Type.STRING, description: 'Termo ou conceito do tema.' },
      definition: { type: Type.STRING, description: 'Definição ou exemplo correto.' },
    },
    required: ['concept', 'definition'],
  };

  const prompt = `Crie UM par conceito/definição diferente sobre "${subject}", nível "${level || 'Ensino Fundamental'}".
Conceito: termo técnico/importante. Definição: explicação clara e didática. Português do Brasil.`;

  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: pairSchema, temperature: 0.9 },
  });

  const text = response.text ?? '';
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('PARSE_ERROR'); }
  const results = normPairs([data], 1);
  if (!results.length) throw new Error('PARSE_ERROR');
  return results[0];
}
