import type { NarrativeChoice } from '../types/game';

export const DEFAULT_NARRATIVE_CHOICES: Record<'forest' | 'city' | 'caves', NarrativeChoice> = {
  forest: {
    prompt: 'Você tem o brilho do conhecimento. Mas diga: de onde ele vem?',
    options: [
      {
        label: '🌿 Do esforço e da dedicação',
        karma: 'luz',
        reaction: 'A generosidade do saber é uma virtude rara. Lembre-se disso.',
      },
      {
        label: '🌑 Da curiosidade, mesmo nos caminhos perigosos',
        karma: 'sombra',
        reaction: 'A curiosidade ousada tem seu preço — e sua recompensa.',
      },
    ],
  },
  city: {
    prompt: 'Para que serve o conhecimento?',
    options: [
      {
        label: '⚙️ Para resolver problemas do mundo',
        karma: 'luz',
        reaction: 'Que ideal nobre! Minha aprovação total!',
      },
      {
        label: '🔮 Para revelar mistérios que outros não veem',
        karma: 'sombra',
        reaction: 'Os maiores mistérios ainda estão por ser descobertos. Adoro sua perspectiva!',
      },
    ],
  },
  caves: {
    prompt: 'O que você faria com o poder do Éter?',
    options: [
      {
        label: '✨ Usaria para ajudar quem não sabe',
        karma: 'luz',
        reaction: 'Compartilhar o saber... Uma escolha que o Éter jamais esquece.',
      },
      {
        label: '🗝️ Guardaria como meu segredo mais valioso',
        karma: 'sombra',
        reaction: 'Os maiores segredos pertencem a quem ousa guardá-los.',
      },
    ],
  },
};
