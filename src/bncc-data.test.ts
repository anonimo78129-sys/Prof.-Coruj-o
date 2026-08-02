import { describe, it, expect } from 'vitest';
import {
  extractBnccCodes, formatBnccBlock, validateBnccSection, selectBnccSkills,
  type BnccSkill,
} from './bncc-data';

// Habilidades reais usadas como "banco injetado no comando" nos testes.
const SKILLS: BnccSkill[] = [
  { code: 'EF05LP01', desc: 'Inferir informações implícitas nos textos lidos', tags: ['leitura'] },
  { code: 'EF04LP01', desc: 'Ler e compreender cartas pessoais de reclamação', tags: ['leitura'] },
];

/** Plano mínimo no formato que o gerador produz. */
const plano = (secaoHabilidade: string) => `## ÁREA DE CONHECIMENTO
Linguagens

## CONTEÚDO
Leitura e interpretação

${secaoHabilidade}

## RECURSOS DIDÁTICOS
Quadro branco e textos impressos

## AVALIAÇÃO
Observação e exercícios`;

const secaoCorreta = `## HABILIDADE (BNCC)
- EF05LP01 — Inferir informações implícitas nos textos lidos
- EF04LP01 — Ler e compreender cartas pessoais de reclamação`;

describe('extractBnccCodes', () => {
  it('encontra códigos do ensino fundamental e do médio', () => {
    const texto = 'Trabalha EF05LP01 e também EM13CNT101 na mesma aula.';
    expect(extractBnccCodes(texto)).toEqual(['EF05LP01', 'EM13CNT101']);
  });

  it('normaliza para maiúsculas e remove repetições', () => {
    expect(extractBnccCodes('ef05lp01 e EF05LP01 de novo')).toEqual(['EF05LP01']);
  });

  it('ignora texto que apenas se parece com código', () => {
    // EF5LP01 (série com 1 dígito) e EM12CNT101 (prefixo errado) não são válidos
    expect(extractBnccCodes('EF5LP01, EM12CNT101, ABC12345')).toEqual([]);
  });

  it('não vaza estado entre chamadas seguidas', () => {
    const texto = 'EF05LP01 e EF04LP01';
    expect(extractBnccCodes(texto)).toEqual(extractBnccCodes(texto));
  });

  it('devolve lista vazia para texto sem código', () => {
    expect(extractBnccCodes('Plano de aula sobre leitura.')).toEqual([]);
  });
});

describe('formatBnccBlock', () => {
  it('monta uma linha por habilidade, com código e descrição', () => {
    expect(formatBnccBlock(SKILLS)).toBe(
      '- EF05LP01 — Inferir informações implícitas nos textos lidos\n' +
      '- EF04LP01 — Ler e compreender cartas pessoais de reclamação',
    );
  });

  it('devolve string vazia sem habilidades', () => {
    expect(formatBnccBlock([])).toBe('');
  });
});

describe('validateBnccSection', () => {
  it('não mexe no plano quando os códigos conferem', () => {
    const original = plano(secaoCorreta);
    const r = validateBnccSection(original, SKILLS);
    expect(r.corrected).toBe(false);
    expect(r.reason).toBe('ok');
    expect(r.text).toBe(original);
  });

  it('corrige código inventado pela IA', () => {
    const r = validateBnccSection(plano(`## HABILIDADE (BNCC)
- EF05LP99 — Habilidade que não existe
- EF04LP01 — Ler e compreender cartas pessoais de reclamação`), SKILLS);

    expect(r.corrected).toBe(true);
    expect(r.reason).toBe('codigo-invalido');
    expect(r.invalidCodes).toEqual(['EF05LP99']);
    expect(r.text).not.toContain('EF05LP99');
    expect(r.text).toContain('EF05LP01');
    expect(r.text).toContain('EF04LP01');
  });

  it('corrige quando a IA esquece uma das habilidades injetadas', () => {
    const r = validateBnccSection(plano(`## HABILIDADE (BNCC)
- EF05LP01 — Inferir informações implícitas nos textos lidos`), SKILLS);

    expect(r.corrected).toBe(true);
    expect(r.reason).toBe('codigo-faltante');
    expect(r.missingCodes).toEqual(['EF04LP01']);
    expect(r.text).toContain('EF04LP01');
  });

  it('corrige quando a seção existe mas não traz nenhum código', () => {
    const r = validateBnccSection(plano(`## HABILIDADE (BNCC)
Habilidades relacionadas à leitura e interpretação de textos.`), SKILLS);

    expect(r.corrected).toBe(true);
    expect(r.reason).toBe('codigo-faltante');
    expect(r.text).toContain('EF05LP01');
    expect(r.text).toContain('EF04LP01');
  });

  it('acrescenta a seção quando a IA não a gerou', () => {
    // Antes esse caso passava batido: o replace não achava a seção e o plano
    // saía sem nenhuma habilidade.
    const semSecao = `## CONTEÚDO
Leitura e interpretação

## AVALIAÇÃO
Observação`;
    const r = validateBnccSection(semSecao, SKILLS);

    expect(r.corrected).toBe(true);
    expect(r.reason).toBe('secao-ausente');
    expect(r.text).toContain('## HABILIDADE (BNCC)');
    expect(r.text).toContain('EF05LP01');
    expect(r.text).toContain('EF04LP01');
    // o conteúdo original não pode ser perdido
    expect(r.text).toContain('## CONTEÚDO');
    expect(r.text).toContain('## AVALIAÇÃO');
  });

  it('preserva as seções vizinhas ao reescrever', () => {
    const r = validateBnccSection(plano(`## HABILIDADE (BNCC)
- EF05LP99 — Inventada`), SKILLS);

    expect(r.text).toContain('## ÁREA DE CONHECIMENTO');
    expect(r.text).toContain('## CONTEÚDO');
    expect(r.text).toContain('## RECURSOS DIDÁTICOS');
    expect(r.text).toContain('## AVALIAÇÃO');
    expect(r.text).toContain('Quadro branco e textos impressos');
  });

  it('reconhece o título da seção em qualquer caixa', () => {
    const r = validateBnccSection(plano(`## Habilidade (BNCC)
- EF05LP99 — Inventada`), SKILLS);

    expect(r.reason).toBe('codigo-invalido');
    expect(r.text).not.toContain('EF05LP99');
  });

  it('devolve o plano intacto sem habilidades injetadas (ex: educação infantil)', () => {
    const original = plano(`## CAMPOS DE EXPERIÊNCIAS (BNCC-EI)
- O eu, o outro e o nós`);
    const r = validateBnccSection(original, []);

    expect(r.corrected).toBe(false);
    expect(r.reason).toBe('ok');
    expect(r.text).toBe(original);
  });

  it('não deixa passar código inválido quando a seção é a última do plano', () => {
    const r = validateBnccSection(`## CONTEÚDO
Leitura

## HABILIDADE (BNCC)
- EF99XX99 — Inventada`, SKILLS);

    expect(r.corrected).toBe(true);
    expect(r.text).not.toContain('EF99XX99');
    expect(r.text).toContain('EF05LP01');
  });

  it('é idempotente: revalidar o resultado não muda mais nada', () => {
    const primeira = validateBnccSection(plano(`## HABILIDADE (BNCC)
- EF05LP99 — Inventada`), SKILLS);
    const segunda = validateBnccSection(primeira.text, SKILLS);

    expect(segunda.corrected).toBe(false);
    expect(segunda.text).toBe(primeira.text);
  });
});

describe('selectBnccSkills', () => {
  it('devolve habilidades reais da disciplina e da série', () => {
    const skills = selectBnccSkills('Língua Portuguesa', '5º ano', 'leitura e interpretação', 3);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.length).toBeLessThanOrEqual(3);
    // todo código selecionado precisa ter o formato oficial
    skills.forEach(s => expect(s.code).toMatch(/^(EF\d{2}[A-Z]{2}\d{2}|EM13[A-Z]{3}\d{3})$/));
  });

  it('aceita variações do nome da disciplina', () => {
    expect(selectBnccSkills('português', '5º ano', 'leitura', 2).length).toBeGreaterThan(0);
  });

  it('devolve lista vazia para disciplina fora do banco', () => {
    expect(selectBnccSkills('Antropologia Visual', '5º ano', 'cultura', 3)).toEqual([]);
  });

  // ── Regressão: apelidos curtos casando dentro de outra palavra ─────────────
  // O casamento era por `includes` cru, então o apelido "ci" de Ciências casava
  // dentro de "soCIologia" e o professor recebia habilidades de Ciências da
  // Natureza (EM13CNT) num plano de Sociologia — que é Ciências Humanas.
  it('não confunde Sociologia com Ciências por causa do apelido "ci"', () => {
    const skills = selectBnccSkills('Sociologia', '1º ano médio', 'cidadania', 3);
    skills.forEach(s => expect(s.code).not.toMatch(/^EM13CNT/));
  });

  it('não confunde Astrobiologia com Biologia por causa do apelido "bio"', () => {
    expect(selectBnccSkills('Astrobiologia Aplicada', '5º ano', 'planetas', 3)).toEqual([]);
  });

  it('mantém Educação Física em Educação Física, e não em Física', () => {
    const skills = selectBnccSkills('Educação Física', '2º ano', 'movimento', 3);
    expect(skills.length).toBeGreaterThan(0);
    skills.forEach(s => expect(s.code).toMatch(/EF$|EF\d{2}$|^EF\d{2}EF/));
  });

  it('o nome composto vence o apelido de uma palavra só', () => {
    // "Educação Física II" contém a palavra "física"; ainda assim deve casar
    // com Educação Física, que é o nome composto mais específico.
    const composta = selectBnccSkills('Educação Física II', '2º ano', 'movimento', 2);
    const simples  = selectBnccSkills('Educação Física', '2º ano', 'movimento', 2);
    expect(composta.map(s => s.code)).toEqual(simples.map(s => s.code));
  });

  it('aceita disciplina qualificada por especialidade', () => {
    const marinha = selectBnccSkills('Biologia Marinha', '1º ano médio', 'ecossistemas', 2);
    const pura    = selectBnccSkills('Biologia', '1º ano médio', 'ecossistemas', 2);
    expect(marinha.map(s => s.code)).toEqual(pura.map(s => s.code));
  });

  it('respeita o limite pedido', () => {
    expect(selectBnccSkills('Língua Portuguesa', '5º ano', 'leitura', 1).length).toBe(1);
  });

  it('as habilidades selecionadas sobrevivem à validação', () => {
    // Garante que o que entra no comando é exatamente o que a validação aceita.
    const skills = selectBnccSkills('Matemática', '5º ano', 'frações', 2);
    if (skills.length === 0) return;
    const planoGerado = `## HABILIDADE (BNCC)\n${formatBnccBlock(skills)}\n\n## AVALIAÇÃO\nObservação`;
    expect(validateBnccSection(planoGerado, skills).corrected).toBe(false);
  });
});
