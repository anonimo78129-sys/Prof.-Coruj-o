// ─────────────────────────────────────────────────────────
// Monta o roteiro do jogo. Sem quiz do professor, devolve a aventura
// padrão (Projeto Amazônia). Com um quiz, mantém a MESMA narrativa mas
// troca as perguntas de múltipla escolha, o pareamento e o banco do
// combate pelo conteúdo do professor.
//
// Os mini-games específicos de botânica (coleta de sementes e ciclo de
// vida) não têm equivalente genérico no quiz do professor, então
// permanecem como estão.
// ─────────────────────────────────────────────────────────
import type { Beat } from './types';
import { ACT1 } from './script';
import type { SharedQuiz } from './quizShare';

export function buildBeats(quiz?: SharedQuiz | null): Beat[] {
  const questions = quiz?.questions.filter(q => q.text?.trim()) ?? [];
  const pairs = quiz?.pairs.filter(p => p.concept?.trim() && p.definition?.trim()) ?? [];
  if (questions.length === 0 && pairs.length === 0) return ACT1.beats;

  let qi = 0;
  const nextQuestion = () => (questions.length ? questions[qi++ % questions.length] : null);

  return ACT1.beats.map((b): Beat => {
    if (b.t === 'question') {
      const q = nextQuestion();
      return q ? { ...b, q: { text: q.text, options: q.options, correct: q.correct } } : b;
    }
    if (b.t === 'match' && pairs.length >= 2) {
      return { ...b, pairs: pairs.slice(0, 6).map(p => ({ left: p.concept, right: p.definition })) };
    }
    if (b.t === 'battle' && questions.length) {
      return { ...b, pool: questions.map(q => ({ text: q.text, options: q.options, correct: q.correct })) };
    }
    return b;
  });
}
