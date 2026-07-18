// ─────────────────────────────────────────────────────────
// Créditos do jogo (Projeto Amazônia / Prof. Corujão).
//
// Lista revisada em conferência completa dos assets em uso no jogo
// publicado (não inclui packs avaliados só na galeria de dev/preview,
// que nunca chegam ao jogador). Atribuições reunidas a partir dos
// arquivos CREDITS.txt/License.txt embutidos nos próprios packs, do
// README de áudio, de pesquisa na internet (quando o arquivo de
// licença não estava embutido) e da árvore de assets do projeto.
// ─────────────────────────────────────────────────────────

export interface CreditItem {
  title: string;        // nome do recurso / pack / faixa
  author?: string;      // autor(a) ou estúdio
  license?: string;     // licença ou termo de uso
  note?: string;        // onde/como é usado no jogo
  url?: string;         // fonte
}

export interface CreditSection {
  heading: string;
  items: CreditItem[];
}

export const CREDITS: CreditSection[] = [
  {
    heading: 'Arte e cenários — pixel art',
    items: [
      {
        title: 'SunnyLand',
        author: 'Ansimuz',
        license: 'CC0 (domínio público)',
        note: 'Raposa companheira, portões, árvores e arbustos.',
        url: 'https://ansimuz.itch.io/sunny-land-pixel-game-art',
      },
      {
        title: 'Free Pixel Art Forest',
        author: 'Eder Muniz',
        license: 'Uso pessoal e comercial, com crédito',
        note: 'Camadas de parallax da floresta.',
        url: 'https://edermunizz.itch.io/free-pixel-art-forest',
      },
      {
        title: 'Legacy Fantasy — High Forest',
        author: 'Anokolisa',
        license: 'Pack gratuito (itch.io)',
        note: 'Céu, colinas e sprites do bosque (Atos 1 a 3).',
        url: 'https://anokolisa.itch.io/sidescroller-pixelart-sprites-asset-pack-forest-16x16',
      },
      {
        title: 'Free Swamp 2D Tileset',
        author: 'Craftpix.net',
        license: 'Gratuito, com crédito',
        note: 'Cenário do pântano (camadas + troncos e salgueiros).',
        url: 'https://craftpix.net/file-licenses/',
      },
      {
        title: 'SunnyLand Tall Forest Environment',
        author: 'Ansimuz',
        license: 'CC0 (domínio público)',
        note: 'Camadas de parallax e props do Ato 1 (fundo, meio, plantas, pedra, musgo). Identificado por pesquisa: nome do pack, autor e as camadas de 240px de altura batem exatamente com os arquivos usados (itch.io e OpenGameArt.org ficaram inacessíveis para conferência direta da página, então a confirmação vem de resultados de busca consistentes, não de um arquivo de licença embutido).',
        url: 'https://ansimuz.itch.io/sunnyland-tall-forest',
      },
      {
        title: 'Jungle Asset Pack',
        author: 'Jesse Munguia',
        license: 'Gratuito — uso pessoal e comercial, sem redistribuição do pack',
        note: 'Camadas de parallax da Clareira e do Pântano. Licença confirmada pelo autor nos comentários da página; identificação por pesquisa, sem CREDITS/README anexado ao arquivo.',
        url: 'https://jesse-m.itch.io/jungle-pack',
      },
      {
        title: 'Ilustrações originais',
        author: 'Equipe do Projeto Amazônia',
        license: 'Criadas para este jogo',
        note: 'Cenas de lore, intro (parada e ônibus), despertar, epílogos, retratos, a Consciência Verde, o Domo-Mãe, a árvore mágica e as maçãs, a Estufa, o Corredor de Luz, e os arbustos/portão em alta resolução do Ato 1 (bush1-4, gate-closed/open, far-custom, layer8-custom — não fazem parte do pack Tall Forest, apesar de estarem na mesma pasta).',
      },
    ],
  },
  {
    heading: 'Áudio — efeitos sonoros',
    items: [
      {
        title: 'Interface Sounds · RPG Audio · Impact Sounds · Digital Audio · Music Jingles',
        author: 'Kenney Vleugels (kenney.nl)',
        license: 'CC0 1.0 Universal',
        note: 'Toque de diálogo, seleção, acerto, erro, portão, passo, ataque, dano e vitória. Licença confirmada no License.txt de cada pack; ver public/escape-assets/audio/sfx/CREDITS.txt para a fonte exata de cada arquivo.',
        url: 'https://kenney.nl',
      },
      {
        title: 'Efeitos sonoros sintetizados (fallback)',
        author: 'Gerados por código no próprio jogo',
        license: 'Original do projeto',
        note: 'Toca automaticamente no lugar de qualquer efeito cujo arquivo esteja ausente — o jogo nunca fica sem som.',
      },
    ],
  },
  {
    heading: 'Áudio — música',
    items: [
      {
        title: '"That Game Arcade (Medium)" — tema da tela inicial',
        author: 'moodmode',
        license: 'Licença de Conteúdo Pixabay',
        note: 'Toca em loop na tela inicial, com fade.',
        url: 'https://pixabay.com/music/',
      },
      {
        title: '"Mystery Vintage Recordings" — tema de exploração',
        author: 'EchoWaveMutawe',
        license: 'Licença de Conteúdo Pixabay',
        note: 'Toca em loop durante a intro e a aventura.',
        url: 'https://pixabay.com/music/',
      },
      {
        title: '"Enemy 2" — tema de combate',
        author: 'Retro-BGM-Chan',
        license: 'Licença de Conteúdo Pixabay',
        note: 'Toca durante o combate com a Consciência Verde.',
        url: 'https://pixabay.com/music/',
      },
      {
        title: 'Trilha chiptune sintetizada (fallback)',
        author: 'Gerada por código no próprio jogo',
        license: 'Original do projeto',
        note: 'Melodia pentatônica em Dó maior, 96 BPM, 8 compassos em loop — toca automaticamente quando um arquivo de música está ausente.',
      },
    ],
  },
  {
    heading: 'Tipografia',
    items: [
      {
        title: 'Press Start 2P',
        author: 'CodeMan38',
        license: 'SIL Open Font License 1.1',
        note: 'Fonte principal da interface do jogo.',
        url: 'https://fonts.google.com/specimen/Press+Start+2P',
      },
      {
        title: 'VT323',
        author: 'Peter Hull',
        license: 'SIL Open Font License 1.1',
        note: 'Fonte secundária, estilo terminal, usada nos diálogos.',
        url: 'https://fonts.google.com/specimen/VT323',
      },
    ],
  },
  {
    heading: 'Tecnologia',
    items: [
      {
        title: 'React, Vite e TypeScript',
        license: 'MIT',
        note: 'Base da aplicação (PWA).',
      },
      {
        title: 'Tailwind CSS · Motion',
        license: 'MIT',
        note: 'Estilo e animações.',
      },
      {
        title: 'qrcode.react · Firebase',
        license: 'MIT / Apache 2.0',
        note: 'QR code de compartilhamento e serviços de nuvem.',
      },
    ],
  },
];

// Aviso de licenças mostrado ao final da página.
export const CREDITS_NOTE =
  'Todos os recursos listados acima têm licença identificada — a maioria ' +
  'confirmada por um arquivo de licença embutido no próprio pack; o ' +
  'SunnyLand Tall Forest Environment e o Jungle Asset Pack foram ' +
  'identificados por pesquisa (nome do pack, autor e detalhes técnicos ' +
  'conferidos, mas sem acesso direto à página de origem para citar o texto ' +
  'literal da licença). Antes de uma distribuição pública ou comercial em ' +
  'maior escala, vale conferir a página oficial de cada um desses dois.';
