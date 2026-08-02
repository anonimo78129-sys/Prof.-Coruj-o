"""Gera src/bncc-dataset.ts a partir dos JSON oficiais do bncc-dev/bncc-dados."""
import json, re

BASE = '/tmp/claude-0/-home-user-Prof--Coruj-o/533fb2d2-d3fa-509f-8018-243f8c506390/scratchpad'
OUT = '/home/user/Prof.-Coruj-o/src/bncc-dataset.ts'

ef = json.load(open(f'{BASE}/ensino-fundamental.json'))['habilidades']
em = json.load(open(f'{BASE}/ensino-medio.json'))['habilidades']
ei = json.load(open(f'{BASE}/educacao-infantil.json'))['objetivos']

rows = []          # [codigo, texto, comp, anos?]
vistos = set()

def limpar(t):
    return ' '.join(t.split()).strip()

# ── Educação Infantil ──────────────────────────────────────────────────────
for o in ei:
    if o.get('vigencia', {}).get('status') != 'vigente':
        continue
    campo = o['campo_experiencias'].replace('ei-campo-', '')   # cg, eo, ts, ef, et
    code = o['codigo']
    if code in vistos: continue
    vistos.add(code)
    rows.append([code, limpar(o['texto']), campo, None])

# ── Ensino Fundamental ─────────────────────────────────────────────────────
for h in ef:
    if h.get('vigencia', {}).get('status') != 'vigente':
        continue
    comp = h['componente'].replace('ef-comp-', '')             # lp, ma, ci, ge, hi, ar, ef, er, li
    code = h['codigo']
    if code in vistos: continue
    vistos.add(code)
    anos = sorted(set(h.get('anos') or []))
    rows.append([code, limpar(h['texto']), comp, anos])

# ── Ensino Médio ───────────────────────────────────────────────────────────
for h in em:
    if h.get('vigencia', {}).get('status') != 'vigente':
        continue
    code = h['codigo']
    if code in vistos: continue
    vistos.add(code)
    # componente específico (em-comp-lp) tem prioridade sobre a área
    comp = (h.get('componente') or h.get('area') or '')
    comp = comp.replace('em-comp-', '').replace('em-area-', '')
    rows.append([code, limpar(h['texto']), comp, None])

rows.sort(key=lambda r: r[0])

def ts_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

linhas = []
for code, texto, comp, anos in rows:
    anos_s = '[' + ','.join(str(a) for a in anos) + ']' if anos else ''
    linhas.append(f'[{ts_str(code)},{ts_str(texto)},{ts_str(comp)}{"," + anos_s if anos_s else ""}]')

conteudo = f'''// ─────────────────────────────────────────────────────────────────────────────
// ARQUIVO GERADO AUTOMATICAMENTE — não edite à mão.
//
// Fonte: bncc-dev/bncc-dados (dados sob CC BY 4.0), extraído das planilhas
// oficiais de downloadbncc.mec.gov.br e verificado caractere a caractere
// contra o PDF homologado da BNCC (MEC, 2018).
// Regerar com: scripts/gerar-bncc-dataset.py
//
// Cobertura: {len(rows)} aprendizagens vigentes
//   · Educação Infantil .... {sum(1 for r in rows if r[0].startswith('EI'))} objetivos de aprendizagem
//   · Ensino Fundamental ... {sum(1 for r in rows if r[0].startswith('EF'))} habilidades
//   · Ensino Médio ......... {sum(1 for r in rows if r[0].startswith('EM'))} habilidades
//
// Este módulo é carregado sob demanda (import dinâmico) para não pesar no
// primeiro carregamento do app.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * [código, texto oficial, componente/área/campo, anos?]
 *
 * · Educação Infantil — componente é o campo de experiências: eo, cg, ts, ef, et
 * · Ensino Fundamental — componente curricular: lp, ma, ci, ge, hi, ar, ef, er, li
 *   e `anos` lista os anos cobertos (EF15LP01 cobre [1,2,3,4,5])
 * · Ensino Médio — área (lgg, mat, cnt, chs) ou componente específico (lp)
 */
export type BnccRow = [code: string, desc: string, comp: string, anos?: number[]];

export const BNCC_ROWS: readonly BnccRow[] = [
{chr(10).join('  ' + l + ',' for l in linhas)}
];
'''

open(OUT, 'w').write(conteudo)

print(f'{len(rows)} registros gravados')
print('  EI:', sum(1 for r in rows if r[0].startswith('EI')))
print('  EF:', sum(1 for r in rows if r[0].startswith('EF')))
print('  EM:', sum(1 for r in rows if r[0].startswith('EM')))
import os
print('tamanho:', round(os.path.getsize(OUT)/1024), 'KB')
