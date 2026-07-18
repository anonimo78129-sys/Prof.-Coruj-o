// ─────────────────────────────────────────────────────────
// Lista central das imagens do jogo + utilitário de pré-carregamento.
// Usada pela tela de carregamento (LoadingScreen) para baixar todas as
// artes antes do jogador começar, evitando "pops" e frames achatados.
// ─────────────────────────────────────────────────────────

const A = (p: string) => `/escape-assets/${p}`;

// Camadas do pack de floresta (Eder Muniz)
const FOREST = [
  'forest/Layer_0011_0.png', 'forest/Layer_0010_1.png', 'forest/Layer_0009_2.png',
  'forest/Layer_0008_3.png', 'forest/Layer_0007_Lights.png', 'forest/Layer_0006_4.png',
  'forest/Layer_0005_5.png', 'forest/Layer_0004_Lights.png', 'forest/Layer_0003_6.png',
  'forest/Layer_0002_7.png', 'forest/Layer_0001_8.png', 'forest/Layer_0000_9.png',
  'forest/Layer_0003_6_c.png', 'forest/Layer_0002_7_c.png',
];

const FLORA = [
  'flora/glow-grass.png', 'flora/flower-blue.png', 'flora/flower-purple.png',
  'flora/flower-tulip.png', 'flora/shroom-big.png', 'flora/shroom-small.png',
];

export const CRITICAL_IMAGES: string[] = [
  // ── tela inicial ──
  'landing-forest.png', 'landing-logo.png', 'landing-char.png',

  // ── retratos / rostos de diálogo ──
  'portraits/owl.png', 'portraits/hero.png', 'portraits/consciencia.png',

  // ── sequência de introdução ──
  'intro/parada-1.png', 'intro/parada-2.png', 'intro/parada-3.png',
  'intro/parada-4.png', 'intro/parada-5.png', 'intro/parada-6.jpg',
  'intro/onibus-1.png', 'intro/onibus-2.png', 'intro/onibus-3.png', 'intro/onibus-4.png',
  'intro/caindo-1.png',
  'intro/acordando-1.png', 'intro/acordando-2.png', 'intro/acordando-3.png', 'intro/acordando-4.png',
  'intro/epilogo-1.jpg', 'intro/epilogo-2.jpg',

  // ── ilustrações de lore (cartões cinemáticos entre os atos) ──
  'lore/gate.png', 'lore/clareira.png', 'lore/apple-tree.png', 'lore/estufa.png',
  'lore/swamp.png', 'lore/corredor.png', 'lore/consciencia.png', 'lore/dome.jpg',
  'lore/arvore-semente.jpg', 'lore/ending-light.jpg', 'lore/ending-dark.jpg',

  // ── floresta / clareira ──
  ...FOREST, ...FLORA,
  'world/ground-dark.png',
  'world/cloud1.png', 'world/cloud2.png', 'world/cloud3.png',
  'world/gate-closed.png', 'world/gate-half.png', 'world/gate-open.png',
  'world/boulder.png',
  'tallforest/gate-closed.png', 'tallforest/gate-open.png',
  'tallforest/back.png', 'tallforest/far.png', 'tallforest/middle.png',

  // ── personagem (sprites de andar/idle/acordar) ──
  'chars/player-walk-1.png', 'chars/player-walk-2.png', 'chars/player-walk-3.png',
  'chars/player-idle-1.png', 'chars/player-idle-2.png',
  'chars/wakeup-1.png', 'chars/wakeup-2.png', 'chars/wakeup-3.png', 'chars/wakeup-4.png',

  // ── Ato 3 — macieira / estufa exterior ──
  'ato3/apple.png', 'ato3/apple-tree.png',
  'ato3/estufa-ext.png', 'ato3/estufa-light.png',
  'ato3/sky.png', 'ato3/mountain-back.png', 'ato3/mountain-front.png',
  'ato3/tree-teal.png', 'ato3/trees-green.png',

  // ── estufa (interior) ──
  'estufa/bg.jpg', 'estufa/bg-interior.png',
  'estufa/reflect-1.png', 'estufa/reflect-2.png',
  'estufa/trunk-1.png', 'estufa/trunk-2.png', 'estufa/trunk-3.png',
  'estufa/computer-off.png', 'estufa/computer-on.png',
  'estufa/guardian-dark.png', 'estufa/plants-fg.png', 'estufa/window-fg.png',

  // ── pântano ──
  'pantano/bg.png', 'pantano/back-silh.png', 'pantano/hills.png', 'pantano/hills2.png',
  'pantano/dead-trees.png', 'pantano/mix-trees.png', 'pantano/logs.png',
  'pantano/ground-fg.png', 'pantano/soil.png', 'pantano/croc.png',
  'pantano/frog1.png', 'pantano/frog2.png', 'pantano/lily.png',
  'pantano/plant-tall.png', 'pantano/plant-bush.png',

  // ── corredor (confronto) ──
  'scenes/corredor.jpg',
  'corredor/battle-bg.jpg', 'corredor/lab.png', 'corredor/layer-fg.png',
  'corredor/layer-1.png', 'corredor/layer-2.png', 'corredor/layer-3.png', 'corredor/layer-4.png',
  'corredor/layer-5.png', 'corredor/layer-6.png', 'corredor/layer-7.png', 'corredor/layer-8.png',
  'corredor/butterfly-1.png', 'corredor/butterfly-2.png',
  'corredor/butterfly-blue-1.png', 'corredor/butterfly-blue-2.png',
  'corredor/consciencia-idle-1.png', 'corredor/consciencia-idle-2.png', 'corredor/consciencia-defeated.png',

  // ── final ──
  'scenes/final.jpg',
  'final/layer-1.png', 'final/layer-2.png', 'final/layer-3.png',
  'final/layer-5.png', 'final/layer-6.png', 'final/layer-7.png',
].map(A);

/**
 * Pré-carrega uma lista de imagens, reportando o progresso.
 * Nunca rejeita: imagens que falham contam como "carregadas" para não travar a tela.
 *
 * @param onProgress  chamado a cada imagem resolvida com (carregadas, total)
 * @param images      lista de URLs (padrão: CRITICAL_IMAGES)
 */
export function preloadImages(
  onProgress?: (loaded: number, total: number) => void,
  images: string[] = CRITICAL_IMAGES,
): Promise<void> {
  const unique = [...new Set(images)];
  const total = unique.length;
  let loaded = 0;

  return new Promise((resolve) => {
    if (total === 0) { resolve(); return; }

    const done = () => {
      loaded++;
      onProgress?.(loaded, total);
      if (loaded >= total) resolve();
    };

    for (const src of unique) {
      const img = new Image();
      img.onload = done;
      img.onerror = done;   // falhas não travam o jogo
      img.src = src;
    }
  });
}
