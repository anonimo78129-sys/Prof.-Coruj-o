// Utilidades de chave da IA — SEM importar a lib pesada do Gemini,
// para que o bundle do aluno não carregue o SDK. O cliente é criado
// dentro de generateGame.ts (import dinâmico).

const LS_KEY = 'eter_gemini_key';

// Reexporta a fonte única em utils.ts — o utils não tem dependência nenhuma,
// então importá-lo aqui não puxa nada de pesado para o bundle do aluno.
export { AI_MODEL as GEMINI_MODEL } from '../../utils';

// Resolve a chave: prioridade para a variável de build (Vercel/.env);
// fallback para uma chave que o professor cole no app (salva localmente).
export function resolveApiKey(): string {
  const envKey = (process.env.GEMINI_API_KEY ?? '').trim();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') return envKey;
  try {
    return (localStorage.getItem(LS_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function hasApiKey(): boolean {
  return resolveApiKey().length > 10;
}

export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(LS_KEY, key.trim());
  } catch {
    /* localStorage indisponível */
  }
}
