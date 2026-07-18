import type { MCQuestion } from '../types/game';

// Quem está falando numa caixa de diálogo
export type Speaker = 'narrador' | 'estudante' | 'corujao' | 'consciencia';

// Cenário/tema visual de fundo
export type SceneBg = 'noite' | 'preto' | 'floresta' | 'clareira' | 'ato3' | 'estufa' | 'pantano' | 'corredor' | 'final';

// Cada "beat" é um passo do roteiro, executado em sequência
export type Beat =
  // Caixa de diálogo: cada string é um "toque para continuar"
  | { t: 'say'; who: Speaker; lines: string[] }
  // Troca o cenário de fundo
  | { t: 'scene'; bg: SceneBg }
  // Transição em fade (com texto opcional centralizado)
  | { t: 'fade'; text?: string }
  // Sequência final ilustrada (epílogo): imagens em tela cheia que fazem
  // crossfade DIRETO de uma para a outra, sem passar pelo preto — como a
  // intro. Cada passo mostra um texto; se `img` for omitido, mantém a
  // imagem do passo anterior (útil para uma fala sobre a mesma imagem).
  | {
      t: 'outro';
      steps: Array<{
        img?: string;       // imagem em tela cheia (mantém a anterior se ausente)
        who?: Speaker;      // se presente: fala de personagem (com retrato)
        text: string;       // texto do passo (narração ou fala)
      }>;
    }
  // O jogador caminha livremente (← →) dentro do segmento de `dist` px.
  // Se houver `landmark`, ao chegar ao fim aparece o indicador + botão OK
  // para entrar na fase; sem landmark, o OK apenas segue o roteiro.
  | { t: 'walk'; dist: number; hint?: string; landmark?: 'gate' | 'estufa-ext' | 'trunk' | 'computer' | 'consciencia' | 'lab' }
  // Um objeto surge no caminho e propõe uma pergunta
  | {
      t: 'question';
      intro?: string;          // fala/narração antes da pergunta
      q: MCQuestion;           // a pergunta (vem do GameConfig ou fallback)
      success: string[];       // falas do estudante ao acertar
      hint?: string;           // dica extra do Prof. Corujão ao errar
    }
  // Pareamento: conectar cada item da esquerda à sua definição/função na direita
  | {
      t: 'match';
      intro?: string;
      pairs: Array<{ left: string; right: string }>;
      success: string[];
      hint?: string;
    }
  // Coleta: itens caem na tela, toque apenas nos corretos
  | {
      t: 'collect';
      intro?: string;
      instruction: string;
      items: Array<{ label: string; correct: boolean }>;
      success: string[];
      hint?: string;
    }
  // Sequência: ordene os passos na ordem correta (ex.: ciclo de vida).
  // Cada toque certo acende uma pedra/vitória-régia formando a ponte.
  | {
      t: 'sequence';
      intro?: string;
      instruction: string;
      steps: string[];        // já na ORDEM CORRETA (são embaralhados na tela)
      success: string[];
      hint?: string;
    }
  // Combate turn-based estilo Pokémon GBA — Consciência Verde
  | {
      t: 'battle';
      intro?: string;
      success: string[];
      hint?: string;
      pool?: MCQuestion[];    // perguntas do combate (do GameConfig; senão usa o banco padrão)
    }
  // Escolha final: decisão com dois desfechos distintos
  | {
      t: 'choice';
      intro?: string;
      prompt: string;
      img?: string;           // ilustração de fundo exibida junto com a pergunta
      options: Array<{
        label: string;
        tone: 'luz' | 'sombra';
        ending: string[];     // epílogo mostrado após a escolha
        img?: string;         // ilustração do desfecho (crossfade suave ao escolher)
      }>;
    }
  // Ilustração de lore: cartão cinemático, toque para continuar
  | {
      t: 'lore';
      img: string;       // caminho relativo a /public (ex: /escape-assets/lore/gate.png)
      caption?: string;  // legenda opcional no estilo caixa de diálogo
      fx?: LoreFxKind;   // camada de animação ambiental sobre a ilustração
      full?: boolean;    // se true: ocupa a tela inteira (cover), escondendo o cenário
    };

// Conjuntos de efeitos animados sobrepostos às ilustrações de lore
export type LoreFxKind =
  | 'portao'       // cogumelos pulsando + vaga-lumes
  | 'clareira'     // raios de luz + bioluminescência
  | 'macieira'     // folhas caindo + pólen dourado
  | 'estufa'       // brilho varrendo o vidro + motes
  | 'pantano'      // névoa + ondulações na água + vaga-lumes verdes
  | 'corredor'     // borboletas + pólen dourado
  | 'consciencia'  // cristal pulsando + esporos
  | 'domo'         // borboletas + brilho no vidro
  | 'semente';     // feixe de luz + pólen subindo

export interface StoryScript {
  beats: Beat[];
}
