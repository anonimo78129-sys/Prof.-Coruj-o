import { describe, it, expect } from 'vitest';
import {
  escapeHtml, shuffleArray, isAdminAccount, canSeedTurmas,
  formatApiError, fmtBytes, toISODate, guessMimeType,
  AI_PRICING, estimateCostUSD,
  TRIAL_DAYS, trialDaysRemaining, isTrialExpired, trialLabel,
} from './utils';

describe('escapeHtml', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<script>alert("x&y")'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&amp;y&quot;)&#39;&lt;/script&gt;');
  });
  it('aceita null/undefined/números sem quebrar', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('shuffleArray', () => {
  it('preserva os elementos e não muta o original', () => {
    const orig = [1, 2, 3, 4, 5];
    const copy = [...orig];
    const out = shuffleArray(orig);
    expect(orig).toEqual(copy);
    expect([...out].sort()).toEqual([...orig].sort());
  });
  it('lida com arrays vazios e de 1 elemento', () => {
    expect(shuffleArray([])).toEqual([]);
    expect(shuffleArray(['a'])).toEqual(['a']);
  });
});

describe('isAdminAccount / canSeedTurmas', () => {
  it('reconhece admin por role', () => {
    expect(isAdminAccount({ role: 'admin' }, null)).toBe(true);
    expect(canSeedTurmas({ role: 'admin' }, null)).toBe(true);
  });
  it('reconhece admin bootstrap por e-mail (case-insensitive)', () => {
    expect(isAdminAccount(null, { email: 'LYELSONMF520@gmail.com' })).toBe(true);
  });
  it('nega usuário comum', () => {
    expect(isAdminAccount({ role: 'user' }, { email: 'x@y.com' })).toBe(false);
    expect(canSeedTurmas(null, { email: 'x@y.com' })).toBe(false);
  });
  it('conta de seed pode importar turmas mas não é admin', () => {
    expect(canSeedTurmas(null, { email: 'slilica69@gmail.com' })).toBe(true);
    expect(isAdminAccount(null, { email: 'slilica69@gmail.com' })).toBe(false);
  });
});

describe('formatApiError', () => {
  it('traduz 429/503 para mensagens amigáveis', () => {
    expect(formatApiError(new Error('429 RESOURCE_EXHAUSTED'), 'x')).toMatch(/Aguarde/);
    expect(formatApiError('503 UNAVAILABLE', 'x')).toMatch(/Muita gente/);
  });
  it('reconhece o marcador de formato da IA', () => {
    expect(formatApiError(new Error('[IA_FORMATO] campo faltando'), 'x')).toMatch(/formato inesperado/);
  });
  it('cai no fallback para erros desconhecidos', () => {
    expect(formatApiError(new Error('boom'), 'fallback')).toBe('fallback');
  });
});

describe('fmtBytes', () => {
  it('formata cada faixa', () => {
    expect(fmtBytes(500)).toBe('500 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(fmtBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });
});

describe('toISODate', () => {
  it('formata sem deslocamento de fuso', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('guessMimeType', () => {
  it('usa o type do arquivo quando existe', () => {
    expect(guessMimeType(new File([], 'a.bin', { type: 'image/png' }))).toBe('image/png');
  });
  it('deduz pela extensão quando o type vem vazio', () => {
    expect(guessMimeType(new File([], 'foto.JPEG'))).toBe('image/jpeg');
    expect(guessMimeType(new File([], 'doc.pdf'))).toBe('application/pdf');
    expect(guessMimeType(new File([], 'sem-extensao'))).toBe('application/pdf');
  });
});

describe('estimateCostUSD', () => {
  it('calcula pelo preço por 1M de tokens', () => {
    expect(estimateCostUSD(1_000_000, 0)).toBeCloseTo(AI_PRICING.inputUsdPer1M);
    expect(estimateCostUSD(0, 1_000_000)).toBeCloseTo(AI_PRICING.outputUsdPer1M);
    expect(estimateCostUSD(0, 0)).toBe(0);
  });
});

// ── Período de teste gratuito ───────────────────────────────────────────────
const dias = (n: number) => new Date(Date.UTC(2026, 0, 10 + n, 12, 0, 0));
const CADASTRO = new Date(Date.UTC(2026, 0, 10, 12, 0, 0)).toISOString();

describe('trialDaysRemaining', () => {
  it('começa com os 7 dias cheios no momento do cadastro', () => {
    expect(trialDaysRemaining(CADASTRO, dias(0))).toBe(TRIAL_DAYS);
  });

  it('desconta um dia por dia corrido', () => {
    expect(trialDaysRemaining(CADASTRO, dias(1))).toBe(6);
    expect(trialDaysRemaining(CADASTRO, dias(3))).toBe(4);
    expect(trialDaysRemaining(CADASTRO, dias(6))).toBe(1);
  });

  it('chega a zero no sétimo dia', () => {
    expect(trialDaysRemaining(CADASTRO, dias(7))).toBe(0);
  });

  it('não fica negativo depois de vencido', () => {
    expect(trialDaysRemaining(CADASTRO, dias(90))).toBe(0);
  });

  it('não conta horas soltas como um dia inteiro', () => {
    const quase = new Date(Date.UTC(2026, 0, 11, 11, 59, 0)); // 23h59 após o cadastro
    expect(trialDaysRemaining(CADASTRO, quase)).toBe(TRIAL_DAYS);
  });

  it('libera o teste quando não há data de cadastro (conta antiga)', () => {
    expect(trialDaysRemaining(undefined, dias(0))).toBe(TRIAL_DAYS);
    expect(trialDaysRemaining(null, dias(0))).toBe(TRIAL_DAYS);
    expect(trialDaysRemaining('', dias(0))).toBe(TRIAL_DAYS);
  });

  it('libera o teste quando a data é inválida', () => {
    expect(trialDaysRemaining('ontem de manhã', dias(0))).toBe(TRIAL_DAYS);
  });

  it('não passa de 7 dias com data de cadastro no futuro', () => {
    // relógio do aparelho adiantado não deve render teste extra
    const futuro = new Date(Date.UTC(2026, 5, 1)).toISOString();
    expect(trialDaysRemaining(futuro, dias(0))).toBe(TRIAL_DAYS);
  });
});

describe('isTrialExpired', () => {
  it('é falso durante o teste', () => {
    expect(isTrialExpired(CADASTRO, dias(0))).toBe(false);
    expect(isTrialExpired(CADASTRO, dias(6))).toBe(false);
  });

  it('é verdadeiro a partir do sétimo dia', () => {
    expect(isTrialExpired(CADASTRO, dias(7))).toBe(true);
    expect(isTrialExpired(CADASTRO, dias(30))).toBe(true);
  });

  it('não expira conta sem data de cadastro', () => {
    expect(isTrialExpired(undefined, dias(0))).toBe(false);
  });
});

describe('trialLabel', () => {
  it('mostra a contagem no plural', () => {
    expect(trialLabel(CADASTRO, dias(0))).toBe('7 dias restantes');
    expect(trialLabel(CADASTRO, dias(2))).toBe('5 dias restantes');
  });

  it('trata o último dia sem dizer "1 dias"', () => {
    expect(trialLabel(CADASTRO, dias(6))).toBe('Último dia de teste');
  });

  it('avisa quando encerrou', () => {
    expect(trialLabel(CADASTRO, dias(7))).toBe('Teste encerrado');
  });
});
