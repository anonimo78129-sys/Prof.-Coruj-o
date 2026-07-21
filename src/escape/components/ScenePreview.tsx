import { useEffect, useRef, useState } from 'react';

type PackScene = { id: string; thumb: string; name: string };
type ParallaxLayer = { src: string; factor: number };

type Pack = {
  label: string;
  badge: string;
  badgeColor: string;
  scenes: PackScene[];
  parallax?: ParallaxLayer[];
  sceneBg?: string;
};

const PACKS: Pack[] = [
  {
    label: 'Pântano — Camadas originais',
    badge: '5 CAMADAS',
    badgeColor: '#88ff66',
    sceneBg: '#bed8aa',
    parallax: [
      { src: '/escape-assets/pantano/back-silh.png',  factor: 0.05 },
      { src: '/escape-assets/pantano/hills.png',       factor: 0.18 },
      { src: '/escape-assets/pantano/dead-trees.png',  factor: 0.40 },
      { src: '/escape-assets/pantano/mix-trees.png',   factor: 0.70 },
      { src: '/escape-assets/pantano/ground-fg.png',   factor: 1.0  },
    ],
    scenes: [
      { id: 'pant-full',     thumb: '/escape-assets/preview/pantano-full.png',     name: 'Cenário 1 — Pântano completo' },
      { id: 'pant-fog',      thumb: '/escape-assets/preview/pantano-fog.png',      name: 'Cenário 2 — Névoa madrugada' },
      { id: 'pant-clearing', thumb: '/escape-assets/preview/pantano-clearing.png', name: 'Cenário 3 — Clareira' },
      { id: 'pant-silh',     thumb: '/escape-assets/pantano/back-silh.png',        name: 'Camada 1 — Silhuetas distantes' },
      { id: 'pant-hills',    thumb: '/escape-assets/pantano/hills.png',            name: 'Camada 2 — Colinas' },
      { id: 'pant-dead',     thumb: '/escape-assets/pantano/dead-trees.png',       name: 'Camada 3 — Árvores mortas' },
      { id: 'pant-mix',      thumb: '/escape-assets/pantano/mix-trees.png',        name: 'Camada 4 — Salgueiro + morta' },
      { id: 'pant-gnd',      thumb: '/escape-assets/pantano/ground-fg.png',        name: 'Camada 5 — Chão (frente)' },
    ],
  },
  {
    label: 'Eder Muniz Forest — Ato 1 (antigo)',
    badge: '12 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/forest/Layer_0011_0.png',   factor: 0.04 },
      { src: '/escape-assets/forest/Layer_0010_1.png',   factor: 0.09 },
      { src: '/escape-assets/forest/Layer_0009_2.png',   factor: 0.15 },
      { src: '/escape-assets/forest/Layer_0008_3.png',   factor: 0.22 },
      { src: '/escape-assets/forest/Layer_0006_4.png',   factor: 0.36 },
      { src: '/escape-assets/forest/Layer_0005_5.png',   factor: 0.46 },
      { src: '/escape-assets/forest/Layer_0003_6.png',   factor: 0.64 },
      { src: '/escape-assets/forest/Layer_0002_7.png',   factor: 0.76 },
      { src: '/escape-assets/forest/Layer_0001_8.png',   factor: 0.90 },
      { src: '/escape-assets/forest/Layer_0000_9.png',   factor: 1.06 },
    ],
    scenes: [
      { id: 'em-l11', thumb: '/escape-assets/forest/Layer_0011_0.png', name: 'Camada 1 — Céu' },
      { id: 'em-l10', thumb: '/escape-assets/forest/Layer_0010_1.png', name: 'Camada 2' },
      { id: 'em-l09', thumb: '/escape-assets/forest/Layer_0009_2.png', name: 'Camada 3' },
      { id: 'em-l08', thumb: '/escape-assets/forest/Layer_0008_3.png', name: 'Camada 4' },
      { id: 'em-l06', thumb: '/escape-assets/forest/Layer_0006_4.png', name: 'Camada 5' },
      { id: 'em-l05', thumb: '/escape-assets/forest/Layer_0005_5.png', name: 'Camada 6' },
      { id: 'em-l03', thumb: '/escape-assets/forest/Layer_0003_6.png', name: 'Camada 7' },
      { id: 'em-l02', thumb: '/escape-assets/forest/Layer_0002_7.png', name: 'Camada 8' },
      { id: 'em-l01', thumb: '/escape-assets/forest/Layer_0001_8.png', name: 'Camada 9' },
      { id: 'em-l00', thumb: '/escape-assets/forest/Layer_0000_9.png', name: 'Camada 10 — Grama (frente)' },
    ],
  },
  {
    label: 'Tall Forest — Ato 1 (atual)',
    badge: '3 CAMADAS',
    badgeColor: '#88ff66',
    parallax: [
      { src: '/escape-assets/tallforest/back.png',   factor: 0.06 },
      { src: '/escape-assets/tallforest/far.png',    factor: 0.30 },
      { src: '/escape-assets/tallforest/middle.png', factor: 0.85 },
    ],
    scenes: [
      { id: 'tf2-back',   thumb: '/escape-assets/preview/tallforest-back.png',   name: 'Camada 1 — Fundo' },
      { id: 'tf2-far',    thumb: '/escape-assets/preview/tallforest-far.png',    name: 'Camada 2 — Distante' },
      { id: 'tf2-middle', thumb: '/escape-assets/preview/tallforest-middle.png', name: 'Camada 3 — Frente' },
    ],
  },
  {
    label: 'GrassLand — Free',
    badge: '5 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/grassland-free-bg1.png', factor: 0.1 },
      { src: '/escape-assets/preview/grassland-free-bg2.png', factor: 0.3 },
      { src: '/escape-assets/preview/grassland-free-bg3.png', factor: 0.5 },
      { src: '/escape-assets/preview/grassland-free-bg4.png', factor: 0.75 },
      { src: '/escape-assets/preview/grassland-free-bg5.png', factor: 1.0 },
    ],
    scenes: [
      { id: 'gl-free-guide',   thumb: '/escape-assets/preview/grassland-free-guide.png',   name: 'Guia de camadas' },
      { id: 'gl-free-example', thumb: '/escape-assets/preview/grassland-free-example.png', name: 'Exemplo completo' },
      { id: 'gl-free-bg1',     thumb: '/escape-assets/preview/grassland-free-bg1.png',     name: 'Camada 1 — Céu' },
      { id: 'gl-free-bg2',     thumb: '/escape-assets/preview/grassland-free-bg2.png',     name: 'Camada 2 — Montanhas' },
      { id: 'gl-free-bg3',     thumb: '/escape-assets/preview/grassland-free-bg3.png',     name: 'Camada 3 — Árvores dist.' },
      { id: 'gl-free-bg4',     thumb: '/escape-assets/preview/grassland-free-bg4.png',     name: 'Camada 4 — Arbustos' },
      { id: 'gl-free-bg5',     thumb: '/escape-assets/preview/grassland-free-bg5.png',     name: 'Camada 5 — Chão' },
    ],
  },
  {
    label: 'GrassLand — Original',
    badge: '4 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/grassland-orig-bg1.png', factor: 0.1 },
      { src: '/escape-assets/preview/grassland-orig-bg2.png', factor: 0.35 },
      { src: '/escape-assets/preview/grassland-orig-bg3.png', factor: 0.65 },
      { src: '/escape-assets/preview/grassland-orig-bg4.png', factor: 1.0 },
    ],
    scenes: [
      { id: 'gl-orig-example', thumb: '/escape-assets/preview/grassland-orig-example.png', name: 'Exemplo completo' },
      { id: 'gl-orig-bg1',     thumb: '/escape-assets/preview/grassland-orig-bg1.png',     name: 'Camada 1 — Céu' },
      { id: 'gl-orig-bg2',     thumb: '/escape-assets/preview/grassland-orig-bg2.png',     name: 'Camada 2 — Montanhas' },
      { id: 'gl-orig-bg3',     thumb: '/escape-assets/preview/grassland-orig-bg3.png',     name: 'Camada 3 — Árvores' },
      { id: 'gl-orig-bg4',     thumb: '/escape-assets/preview/grassland-orig-bg4.png',     name: 'Camada 4 — Primeiro plano' },
    ],
  },
  {
    label: 'PixelFantasy — Cavernas',
    badge: '5 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/caves-bg1.png',  factor: 0.05 },
      { src: '/escape-assets/preview/caves-bg2.png',  factor: 0.2  },
      { src: '/escape-assets/preview/caves-bg3.png',  factor: 0.4  },
      { src: '/escape-assets/preview/caves-bg4a.png', factor: 0.7  },
      { src: '/escape-assets/preview/caves-bg4b.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'caves-bg1',  thumb: '/escape-assets/preview/caves-bg1.png',  name: 'Camada 1 — Fundo escuro' },
      { id: 'caves-bg2',  thumb: '/escape-assets/preview/caves-bg2.png',  name: 'Camada 2 — Rochas dist.' },
      { id: 'caves-bg3',  thumb: '/escape-assets/preview/caves-bg3.png',  name: 'Camada 3 — Stalactites' },
      { id: 'caves-bg4a', thumb: '/escape-assets/preview/caves-bg4a.png', name: 'Camada 4a — Pilastras' },
      { id: 'caves-bg4b', thumb: '/escape-assets/preview/caves-bg4b.png', name: 'Camada 4b — Chão' },
    ],
  },
  {
    label: 'Forest Monsters — Sprites',
    badge: 'SPRITES',
    badgeColor: '#ff9060',
    scenes: [
      { id: 'monsters-idle',   thumb: '/escape-assets/preview/monsters-mushroom-idle.png',   name: 'Cogumelo — Idle' },
      { id: 'monsters-run',    thumb: '/escape-assets/preview/monsters-mushroom-run.png',    name: 'Cogumelo — Run' },
      { id: 'monsters-attack', thumb: '/escape-assets/preview/monsters-mushroom-attack.png', name: 'Cogumelo — Attack' },
      { id: 'monsters-die',    thumb: '/escape-assets/preview/monsters-mushroom-die.png',    name: 'Cogumelo — Die' },
    ],
  },
  {
    label: 'Legacy Fantasy — High Forest',
    badge: '2 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/legacy-bg.png',       factor: 0.12 },
      { src: '/escape-assets/preview/legacy-trees-bg.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'legacy-bg',        thumb: '/escape-assets/preview/legacy-bg.png',        name: 'Camada 1 — Céu e colinas' },
      { id: 'legacy-trees-bg',  thumb: '/escape-assets/preview/legacy-trees-bg.png',  name: 'Camada 2 — Árvores' },
      { id: 'legacy-char-idle', thumb: '/escape-assets/preview/legacy-char-idle.png', name: 'Personagem — Idle' },
      { id: 'legacy-mob-boar',  thumb: '/escape-assets/preview/legacy-mob-boar.png',  name: 'Mob — Javali' },
      { id: 'legacy-mob-bee',   thumb: '/escape-assets/preview/legacy-mob-bee.png',   name: 'Mob — Abelha' },
    ],
  },
  {
    label: 'SunnyLand Forest — Godot',
    badge: '2 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/sunnyland-godot-bg.png', factor: 0.15 },
      { src: '/escape-assets/preview/sunnyland-godot-mg.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'sl-godot-bg',      thumb: '/escape-assets/preview/sunnyland-godot-bg.png',      name: 'Camada 1 — Background' },
      { id: 'sl-godot-mg',      thumb: '/escape-assets/preview/sunnyland-godot-mg.png',      name: 'Camada 2 — Middleground' },
      { id: 'sl-godot-player',  thumb: '/escape-assets/preview/sunnyland-godot-player.png',  name: 'Personagem — Idle' },
      { id: 'sl-godot-tileset', thumb: '/escape-assets/preview/sunnyland-godot-tileset.png', name: 'Tileset — Mundo' },
    ],
  },
  {
    label: 'SunnyLand Forest — Phaser',
    badge: '2 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/phaser-bg.png', factor: 0.15 },
      { src: '/escape-assets/preview/phaser-mg.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'phaser-bg',    thumb: '/escape-assets/preview/phaser-bg.png',    name: 'Camada 1 — Background' },
      { id: 'phaser-mg',    thumb: '/escape-assets/preview/phaser-mg.png',    name: 'Camada 2 — Middleground' },
      { id: 'phaser-atlas', thumb: '/escape-assets/preview/phaser-atlas.png', name: 'Atlas — Sprites' },
      { id: 'phaser-title', thumb: '/escape-assets/preview/phaser-title.png', name: 'Tela de título' },
    ],
  },
  {
    label: 'Pixel Crawler — RPG Tileset',
    badge: 'TILESET',
    badgeColor: '#c080ff',
    scenes: [
      { id: 'crawler-dungeon',   thumb: '/escape-assets/preview/crawler-dungeon.png',   name: 'Dungeon tiles' },
      { id: 'crawler-floors',    thumb: '/escape-assets/preview/crawler-floors.png',    name: 'Floor tiles' },
      { id: 'crawler-walls',     thumb: '/escape-assets/preview/crawler-walls.png',     name: 'Wall tiles' },
      { id: 'crawler-char-idle', thumb: '/escape-assets/preview/crawler-char-idle.png', name: 'Personagem — Idle' },
    ],
  },
  {
    label: 'Tall Forest',
    badge: '3 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/tallforest-back.png',   factor: 0.08 },
      { src: '/escape-assets/preview/tallforest-far.png',    factor: 0.35 },
      { src: '/escape-assets/preview/tallforest-middle.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'tf-preview', thumb: '/escape-assets/preview/tallforest-preview.png', name: 'Cena completa' },
      { id: 'tf-back',    thumb: '/escape-assets/preview/tallforest-back.png',    name: 'Camada 1 — Fundo' },
      { id: 'tf-far',     thumb: '/escape-assets/preview/tallforest-far.png',     name: 'Camada 2 — Distante' },
      { id: 'tf-middle',  thumb: '/escape-assets/preview/tallforest-middle.png',  name: 'Camada 3 — Primeiro plano' },
    ],
  },
  {
    label: 'SunnyLand Forest — Arquivos Originais',
    badge: '3 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/sunnyland-files-bg.png',    factor: 0.12 },
      { src: '/escape-assets/preview/sunnyland-files-mg.png',    factor: 0.5  },
      { src: '/escape-assets/preview/sunnyland-files-props.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'slf-preview', thumb: '/escape-assets/preview/sunnyland-files-preview.png', name: 'Cena completa' },
      { id: 'slf-bg',      thumb: '/escape-assets/preview/sunnyland-files-bg.png',      name: 'Camada 1 — Background' },
      { id: 'slf-mg',      thumb: '/escape-assets/preview/sunnyland-files-mg.png',      name: 'Camada 2 — Middleground' },
      { id: 'slf-props',   thumb: '/escape-assets/preview/sunnyland-files-props.png',   name: 'Camada 3 — Props' },
      { id: 'slf-player',  thumb: '/escape-assets/preview/sunnyland-files-player.png',  name: 'Personagem — Idle' },
      { id: 'slf-bee',     thumb: '/escape-assets/preview/sunnyland-files-bee.png',     name: 'Inimigo — Abelha' },
    ],
  },
  {
    label: 'Minifolks — Animais da Floresta',
    badge: 'SPRITES',
    badgeColor: '#ff9060',
    scenes: [
      { id: 'mf-fox',    thumb: '/escape-assets/preview/minifolks-fox.png',    name: 'Raposa' },
      { id: 'mf-deer',   thumb: '/escape-assets/preview/minifolks-deer.png',   name: 'Cervo' },
      { id: 'mf-bear',   thumb: '/escape-assets/preview/minifolks-bear.png',   name: 'Urso' },
      { id: 'mf-bird',   thumb: '/escape-assets/preview/minifolks-bird.png',   name: 'Pássaro' },
      { id: 'mf-wolf',   thumb: '/escape-assets/preview/minifolks-wolf.png',   name: 'Lobo' },
      { id: 'mf-bunny',  thumb: '/escape-assets/preview/minifolks-bunny.png',  name: 'Coelho' },
    ],
  },
  {
    label: 'Forest of Illusion',
    badge: '2 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/illusion-back.png',   factor: 0.1 },
      { src: '/escape-assets/preview/illusion-middle.png', factor: 1.0 },
    ],
    scenes: [
      { id: 'ill-preview', thumb: '/escape-assets/preview/illusion-preview.png', name: 'Preview completo' },
      { id: 'ill-back',    thumb: '/escape-assets/preview/illusion-back.png',    name: 'Camada 1 — Fundo' },
      { id: 'ill-middle',  thumb: '/escape-assets/preview/illusion-middle.png',  name: 'Camada 2 — Frente' },
      { id: 'ill-tiles',   thumb: '/escape-assets/preview/illusion-tiles.png',   name: 'Tileset' },
    ],
  },
  {
    label: 'SunnyLand Winter Forest',
    badge: '4 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/slwinter-sky.png',       factor: 0.05 },
      { src: '/escape-assets/preview/slwinter-mountains.png', factor: 0.2  },
      { src: '/escape-assets/preview/slwinter-mida.png',      factor: 0.55 },
      { src: '/escape-assets/preview/slwinter-midb.png',      factor: 1.0  },
    ],
    scenes: [
      { id: 'slw-sky',    thumb: '/escape-assets/preview/slwinter-sky.png',       name: 'Camada 1 — Céu' },
      { id: 'slw-mtn',    thumb: '/escape-assets/preview/slwinter-mountains.png', name: 'Camada 2 — Montanhas' },
      { id: 'slw-mida',   thumb: '/escape-assets/preview/slwinter-mida.png',      name: 'Camada 3 — Meio A' },
      { id: 'slw-midb',   thumb: '/escape-assets/preview/slwinter-midb.png',      name: 'Camada 4 — Meio B' },
      { id: 'slw-yeti',   thumb: '/escape-assets/preview/slwinter-yeti.png',      name: 'Inimigo — Yeti' },
    ],
  },
  {
    label: 'Magic Cliffs — Godot',
    badge: '4 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/magic-sky.png',        factor: 0.05 },
      { src: '/escape-assets/preview/magic-clouds.png',     factor: 0.2  },
      { src: '/escape-assets/preview/magic-fargrounds.png', factor: 0.55 },
      { src: '/escape-assets/preview/magic-sea.png',        factor: 1.0  },
    ],
    scenes: [
      { id: 'mc-sky',    thumb: '/escape-assets/preview/magic-sky.png',        name: 'Camada 1 — Céu' },
      { id: 'mc-clouds', thumb: '/escape-assets/preview/magic-clouds.png',     name: 'Camada 2 — Nuvens' },
      { id: 'mc-far',    thumb: '/escape-assets/preview/magic-fargrounds.png', name: 'Camada 3 — Penhascos' },
      { id: 'mc-sea',    thumb: '/escape-assets/preview/magic-sea.png',        name: 'Camada 4 — Mar' },
      { id: 'mc-player', thumb: '/escape-assets/preview/magic-player-idle.png', name: 'Personagem — Idle' },
    ],
  },
  {
    label: 'Free Cute Tileset',
    badge: '3 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/cute-bg1.png', factor: 0.1  },
      { src: '/escape-assets/preview/cute-bg2.png', factor: 0.45 },
      { src: '/escape-assets/preview/cute-bg3.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'cute-mockup',  thumb: '/escape-assets/preview/cute-mockup.png',  name: 'Mockup — Cena completa' },
      { id: 'cute-bg1',     thumb: '/escape-assets/preview/cute-bg1.png',     name: 'Camada 1 — Fundo' },
      { id: 'cute-bg2',     thumb: '/escape-assets/preview/cute-bg2.png',     name: 'Camada 2 — Meio' },
      { id: 'cute-bg3',     thumb: '/escape-assets/preview/cute-bg3.png',     name: 'Camada 3 — Frente' },
      { id: 'cute-tileset', thumb: '/escape-assets/preview/cute-tileset.png', name: 'Tileset' },
    ],
  },
  {
    label: 'Jungle Asset Pack',
    badge: '5 CAMADAS',
    badgeColor: '#40e0d0',
    parallax: [
      { src: '/escape-assets/preview/jungle-plx1.png', factor: 0.05 },
      { src: '/escape-assets/preview/jungle-plx2.png', factor: 0.15 },
      { src: '/escape-assets/preview/jungle-plx3.png', factor: 0.35 },
      { src: '/escape-assets/preview/jungle-plx4.png', factor: 0.65 },
      { src: '/escape-assets/preview/jungle-plx5.png', factor: 1.0  },
    ],
    scenes: [
      { id: 'jng-mockup', thumb: '/escape-assets/preview/jungle-mockup.png',  name: 'Mockup — Cena completa' },
      { id: 'jng-plx1',   thumb: '/escape-assets/preview/jungle-plx1.png',   name: 'Camada 1 — Fundo' },
      { id: 'jng-plx2',   thumb: '/escape-assets/preview/jungle-plx2.png',   name: 'Camada 2' },
      { id: 'jng-plx3',   thumb: '/escape-assets/preview/jungle-plx3.png',   name: 'Camada 3' },
      { id: 'jng-plx4',   thumb: '/escape-assets/preview/jungle-plx4.png',   name: 'Camada 4' },
      { id: 'jng-plx5',   thumb: '/escape-assets/preview/jungle-plx5.png',   name: 'Camada 5 — Frente' },
      { id: 'jng-ts',     thumb: '/escape-assets/preview/jungle-tileset.png', name: 'Tileset' },
    ],
  },
  {
    label: 'Flying Forest Enemies',
    badge: 'SPRITES',
    badgeColor: '#ff9060',
    scenes: [
      { id: 'fly-idle',   thumb: '/escape-assets/preview/flying-enemy3-idle.png',   name: 'Enemy3 — Idle' },
      { id: 'fly-fly',    thumb: '/escape-assets/preview/flying-enemy3-fly.png',    name: 'Enemy3 — Fly' },
      { id: 'fly-attack', thumb: '/escape-assets/preview/flying-enemy3-attack.png', name: 'Enemy3 — Attack' },
      { id: 'fly-die',    thumb: '/escape-assets/preview/flying-enemy3-die.png',    name: 'Enemy3 — Die' },
    ],
  },
  {
    label: 'Village Props — Pixel Art',
    badge: 'TILESET',
    badgeColor: '#c080ff',
    scenes: [
      { id: 'vil-props',  thumb: '/escape-assets/preview/village-props.png',  name: 'Props do vilarejo' },
      { id: 'vil-ground', thumb: '/escape-assets/preview/village-ground.png', name: 'Chão / terreno' },
      { id: 'vil-chest',  thumb: '/escape-assets/preview/village-chest.png',  name: 'Baú (animação)' },
      { id: 'vil-flame',  thumb: '/escape-assets/preview/village-flame.png',  name: 'Chama FX' },
    ],
  },
  {
    label: 'Fonts — GB Studio',
    badge: 'FONTES',
    badgeColor: '#ffd060',
    scenes: [
      { id: 'fgb-default', thumb: '/escape-assets/preview/fonts-gb-default.png', name: 'Default' },
      { id: 'fgb-slant',   thumb: '/escape-assets/preview/fonts-gb-slant.png',   name: 'Slant' },
      { id: 'fgb-thick',   thumb: '/escape-assets/preview/fonts-gb-thick.png',   name: 'Thick' },
      { id: 'fgb-tiny',    thumb: '/escape-assets/preview/fonts-gb-tiny.png',    name: 'Tiny' },
      { id: 'fgb-frenger', thumb: '/escape-assets/preview/fonts-gb-frenger.png', name: 'Frengertype' },
    ],
  },
  {
    label: '11 Game Boy Font Pack',
    badge: 'FONTES',
    badgeColor: '#ffd060',
    scenes: [
      { id: 'gb11-01', thumb: '/escape-assets/preview/fonts-gb11-01.png', name: 'AccessDenied Mono' },
      { id: 'gb11-05', thumb: "/escape-assets/preview/fonts-gb11-05.png", name: "That's Delaware" },
      { id: 'gb11-10', thumb: '/escape-assets/preview/fonts-gb11-10.png', name: '16-bit Dreams Clean' },
      { id: 'gb11-13', thumb: '/escape-assets/preview/fonts-gb11-13.png', name: 'DetectivesNdames' },
    ],
  },
];

const totalScenes = PACKS.reduce((s, p) => s + p.scenes.length, 0);

// ── LOGO em pixel art (3 estilos) ─────────────────────────────────────────────
// Estilo do "MUNDO PERDIDO — ESCAPE ROOM": letras blocadas, verde, com profundidade 3D.
const LOGO_LINES = ['JARDIM', 'BOTÂNICO'];
const LOGO_SUB = 'A FLORESTA VIVA';

function PixelLogo({ variant }: { variant: 1 | 2 | 3 }) {
  // extrusão 3D (sombra empilhada diagonal)
  const extrude = (color: string, depth: number) =>
    Array.from({ length: depth }, (_, i) => `${i + 1}px ${i + 1}px 0 ${color}`).join(', ');

  // ── ESTILO 1 — Clássico (igual à referência): verde com extrusão escura + contorno
  if (variant === 1) {
    return (
      <div style={{ textAlign: 'center', lineHeight: 1.05, padding: '8px 0' }}>
        {LOGO_LINES.map(line => (
          <div key={line} className="font-pixel" style={{
            fontSize: 'clamp(26px, 9vw, 52px)',
            background: 'linear-gradient(#bdf25a 0%, #74c82c 48%, #3f8f12 100%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            WebkitTextStroke: '2px #173a09',
            textShadow: extrude('#173a09', 7),
            letterSpacing: 2,
          }}>{line}</div>
        ))}
        <div className="font-pixel" style={{
          marginTop: 12, fontSize: 'clamp(11px, 3.4vw, 18px)',
          color: '#a96a2c', WebkitTextStroke: '1px #4a2a0c',
          textShadow: extrude('#4a2a0c', 4), letterSpacing: 4,
        }}>{LOGO_SUB}</div>
      </div>
    );
  }

  // ── ESTILO 2 — Contorno grosso (lima vibrante, borda preta marcante)
  if (variant === 2) {
    return (
      <div style={{ textAlign: 'center', lineHeight: 1.05, padding: '8px 0' }}>
        {LOGO_LINES.map(line => (
          <div key={line} className="font-pixel" style={{
            fontSize: 'clamp(26px, 9vw, 52px)',
            background: 'linear-gradient(#e8ff8a 0%, #9be03a 50%, #5aab1e 100%)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            WebkitTextStroke: '3px #0b2604',
            textShadow: `${extrude('#0b2604', 4)}, 0 5px 8px rgba(0,0,0,0.55)`,
            letterSpacing: 2,
          }}>{line}</div>
        ))}
        <div className="font-pixel" style={{
          marginTop: 12, fontSize: 'clamp(11px, 3.4vw, 18px)',
          color: '#ffd24a', WebkitTextStroke: '2px #5a3a08',
          textShadow: extrude('#5a3a08', 3), letterSpacing: 4,
        }}>{LOGO_SUB}</div>
      </div>
    );
  }

  // ── ESTILO 3 — Mágico (verde com brilho turquesa, clima da floresta encantada)
  return (
    <div style={{ textAlign: 'center', lineHeight: 1.05, padding: '8px 0' }}>
      {LOGO_LINES.map(line => (
        <div key={line} className="font-pixel" style={{
          fontSize: 'clamp(26px, 9vw, 52px)',
          background: 'linear-gradient(#d6ffe8 0%, #5ad29a 45%, #2f9466 100%)',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          WebkitTextStroke: '2px #0d3326',
          textShadow: `${extrude('#0d3326', 5)}, 0 0 14px rgba(64,224,208,0.85), 0 0 28px rgba(64,224,208,0.5)`,
          letterSpacing: 2,
        }}>{line}</div>
      ))}
      <div className="font-pixel" style={{
        marginTop: 12, fontSize: 'clamp(11px, 3.4vw, 18px)',
        color: '#40e0d0', WebkitTextStroke: '1px #0d3326',
        textShadow: '0 0 10px rgba(64,224,208,0.8), 0 2px 0 #0d3326', letterSpacing: 4,
      }}>{LOGO_SUB}</div>
    </div>
  );
}

// ── Parallax demo modal ──────────────────────────────────────────────────────
function ParallaxDemo({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const scrollRef = useRef(0);
  const rafRef = useRef<number>(0);
  const layerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const speed = 0.6; // px per frame at 60fps
    const width = 800;

    function tick() {
      scrollRef.current = (scrollRef.current + speed) % width;
      const x = scrollRef.current;
      layerRefs.current.forEach((el, i) => {
        if (!el || !pack.parallax) return;
        const factor = pack.parallax[i]?.factor ?? 0;
        el.style.backgroundPositionX = `${-Math.round(x * factor)}px`;
      });
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pack]);

  const layers = pack.parallax ?? [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: '#000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, cursor: 'pointer',
      }}
    >
      {/* scene container */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 600, aspectRatio: '2/1', overflow: 'hidden', background: pack.sceneBg ?? '#000' }}>
        {layers.map((layer, i) => (
          <div
            key={layer.src}
            ref={el => { layerRefs.current[i] = el; }}
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: `url(${layer.src})`,
              backgroundRepeat: 'repeat-x',
              backgroundSize: 'auto 100%',
              backgroundPositionX: '0px',
              imageRendering: 'pixelated',
            }}
          />
        ))}
      </div>

      <p style={{ fontSize: 10, letterSpacing: 2, color: '#40e0d0', fontFamily: 'monospace' }}>
        {pack.label.toUpperCase()} — {layers.length} CAMADAS EM PARALLAX
      </p>

      {/* layer indicators */}
      <div style={{ display: 'flex', gap: 6 }}>
        {layers.map((l, i) => (
          <div key={i} style={{
            width: 20, height: 4, borderRadius: 2,
            background: `rgba(64,224,208,${0.2 + (i / (layers.length - 1)) * 0.8})`,
          }} />
        ))}
      </div>

      <p style={{ fontSize: 8, color: '#4a7a4a', fontFamily: 'monospace' }}>toque para fechar</p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ScenePreview({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [demoPackLabel, setDemoPackLabel] = useState<string | null>(null);

  const allScenes = PACKS.flatMap(p => p.scenes);
  const full = selected ? allScenes.find(s => s.id === selected) : null;
  const demoPack = demoPackLabel ? PACKS.find(p => p.label === demoPackLabel) : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#060d07', overflow: 'auto',
      fontFamily: 'monospace', color: '#cfe8c0',
    }}>
      {/* topo */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(6,13,7,0.97)', borderBottom: '1px solid #1a3a1a',
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: '1px solid #2f6b34', color: '#88ff66', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 11 }}>
          ← VOLTAR
        </button>
        <span style={{ fontSize: 11, letterSpacing: 2, color: '#88ff66' }}>CENÁRIOS — PREVIEW</span>
        <span style={{ fontSize: 10, color: '#4a7a4a', marginLeft: 'auto' }}>{totalScenes} itens · {PACKS.length} packs</span>
      </div>

      {/* ── LOGO — 3 estilos em pixel art ── */}
      <div style={{ padding: '20px 12px 8px' }}>
        <div style={{ color: '#40e0d0', fontSize: 10, letterSpacing: 3, marginBottom: 14 }}>
          LOGO — 3 ESTILOS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[1, 2, 3].map(v => (
            <div key={v} style={{
              position: 'relative',
              background: 'radial-gradient(circle at 50% 40%, #0e2412, #060d07 80%)',
              border: '1px solid #1a3a1a', borderRadius: 10,
              padding: '22px 12px 18px', overflow: 'hidden',
            }}>
              <span style={{
                position: 'absolute', top: 8, left: 10,
                fontSize: 8, letterSpacing: 1, color: '#4a7a4a',
              }}>ESTILO {v}</span>
              <PixelLogo variant={v as 1 | 2 | 3} />
            </div>
          ))}
        </div>
      </div>

      {/* galeria */}
      <div style={{ padding: '16px 12px 40px' }}>
        {PACKS.map(pack => (
          <div key={pack.label} style={{ marginBottom: 32 }}>
            {/* pack header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingLeft: 2 }}>
              <p style={{ fontSize: 9, letterSpacing: 2, color: '#40e0d0', margin: 0 }}>
                {pack.label.toUpperCase()}
              </p>
              <span style={{
                fontSize: 8,
                background: `${pack.badgeColor}22`,
                border: `1px solid ${pack.badgeColor}`,
                color: pack.badgeColor,
                borderRadius: 4, padding: '2px 6px', letterSpacing: 1,
              }}>
                {pack.badge}
              </span>

              {/* parallax demo button */}
              {pack.parallax && (
                <button
                  onClick={e => { e.stopPropagation(); setDemoPackLabel(pack.label); }}
                  style={{
                    marginLeft: 'auto',
                    background: 'rgba(64,224,208,0.12)', border: '1px solid #40e0d0',
                    color: '#40e0d0', borderRadius: 4, padding: '3px 10px',
                    fontSize: 8, letterSpacing: 1, cursor: 'pointer',
                  }}>
                  ▶ DEMO PARALLAX
                </button>
              )}
            </div>

            {/* thumbnails grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {pack.scenes.map(scene => (
                <div
                  key={scene.id}
                  onClick={() => setSelected(scene.id)}
                  style={{
                    borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                    border: '2px solid #1a3a1a',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#40e0d0')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a3a1a')}
                >
                  <img
                    src={scene.thumb}
                    alt={scene.name}
                    style={{ width: '100%', display: 'block', imageRendering: 'pixelated' }}
                  />
                  <div style={{ background: 'rgba(8,20,10,0.9)', padding: '4px 8px', fontSize: 8, color: '#9ad08f', letterSpacing: 1 }}>
                    {scene.name.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* lightbox */}
      {full && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: 16, cursor: 'pointer',
          }}>
          <img
            src={full.thumb}
            alt={full.name}
            style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 8, imageRendering: 'pixelated', border: '2px solid #40e0d0' }}
          />
          <p style={{ fontSize: 10, letterSpacing: 2, color: '#40e0d0' }}>{full.name.toUpperCase()}</p>
          <p style={{ fontSize: 8, color: '#4a7a4a' }}>toque para fechar</p>
        </div>
      )}

      {/* parallax demo */}
      {demoPack && (
        <ParallaxDemo pack={demoPack} onClose={() => setDemoPackLabel(null)} />
      )}

      {/* ── GALERIA DE FONTES ── */}
      <div style={{ padding: '0 16px 40px' }}>
        <div style={{ color: '#40e0d0', fontFamily: 'monospace', fontSize: 10, letterSpacing: 3, marginBottom: 16, marginTop: 8 }}>
          FONTES DISPONÍVEIS — "Escape Room"
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { name: '16 Bit Dreams',      family: '16BitDreams' },
            { name: 'Access Denied',      family: 'AccessDenied' },
            { name: 'Detectives N\' Dames', family: 'DetectivesDames' },
            { name: 'Eaten by Grues',     family: 'EatenByGrues' },
            { name: 'Lanky Git',          family: 'LankyGit' },
            { name: 'Lord Flimbington',   family: 'LordFlimbington' },
            { name: 'Mythos Maximus',     family: 'MythosMaximus' },
            { name: 'That\'s Delaware!',  family: 'ThatsDelaware' },
            { name: 'Yore in Peril',      family: 'YoreInPeril' },
            { name: 'Ittiest Bittiest',   family: 'ItttiestBittiest' },
            { name: 'Itty Bitty',         family: 'IttyBitty' },
            { name: 'Alagard',            family: 'Alagard' },
            { name: 'Romulus',            family: 'Romulus' },
          ].map(f => (
            <div key={f.family} style={{ background: 'rgba(8,20,10,0.85)', border: '1px solid #1a3a1a', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontFamily: f.family, fontSize: 22, color: '#e8f8e0', letterSpacing: 2, marginBottom: 4 }}>
                Escape Room
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#4a7a4a', letterSpacing: 1 }}>
                {f.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
