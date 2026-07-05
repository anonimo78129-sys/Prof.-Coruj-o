import { describe, it, expect } from 'vitest';
import {
  escapeHtml, shuffleArray, isAdminAccount, canSeedTurmas,
  formatApiError, fmtBytes, toISODate, guessMimeType,
  AI_PRICING, estimateCostUSD,
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
