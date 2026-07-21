# Efeitos sonoros e música do jogo

O sistema de áudio já está **pronto e ligado** no código (`src/game/audio.ts`
para SFX e `src/game/music.ts` para a trilha). Tudo é **opcional**: enquanto
não houver arquivos aqui, o jogo toca os sons **sintetizados em 8-bit**
(gerados por código, estilo chiptune). Assim que você colocar os arquivos com
os nomes abaixo, eles passam a tocar **automaticamente** — não precisa mexer
em código.

## 🎵 Música de fundo → `music/`

| Arquivo                 | Quando toca                                     |
|-------------------------|--------------------------------------------------|
| `music/home-theme.mp3`  | Em loop na **tela inicial** (com fade in/out)   |
| `music/explore.mp3`     | Em loop durante a intro e a exploração do jogo  |
| `music/battle.mp3`      | Em loop durante o **combate** (Consciência Verde) |

`home-theme.mp3`, `explore.mp3` e `battle.mp3` já estão presentes.
`home-theme.mp3` toca assim que a tela inicial abre — ou no primeiro
toque, se o navegador bloquear o autoplay — e some com fade ao sair
para o jogo. `explore.mp3` toca em loop pela intro e pela aventura;
ao entrar em combate, ela pausa suavemente e `battle.mp3` assume,
retomando de onde parou assim que a luta termina. Sem esses arquivos,
o jogo cai de volta no **tema de exploração chiptune** sintetizado
(Dó maior pentatônica, 96 BPM, 8 compassos em loop) — inclusive
durante o combate, se faltar só o `battle.mp3`. Todas as trilhas
respeitam o mudo/volume do jogo.

`explore.mp3` é "Mystery Vintage Recordings", de EchoWaveMutawe; `home-theme.mp3`
é "That Game Arcade (Medium)", de moodmode; `battle.mp3` é "Enemy 2", de
Retro-BGM-Chan — todas baixadas do Pixabay Music sob a Licença Pixabay (uso
livre, atribuição não obrigatória; ver `music/CREDITS.txt` para os detalhes
de cada uma).

Formato recomendado: **.mp3** (compatível com todos os navegadores).
Também aceita `.ogg`/`.wav` se você trocar a extensão no mapa `SFX_FILES` do `audio.ts`.

---

## 🔊 Efeitos sonoros  → `sfx/`

Os 9 arquivos que estavam aqui antes vinham do pack "Watabou Pixel Dungeon
Sound Effects", cujo `LICENSE.txt` cobria só o código-fonte do jogo (GPLv3) —
sem declaração separada sobre a licença dos *sons* em si. Foram substituídos
por sons do Kenney (kenney.nl), **CC0 confirmado individualmente** em cada
pack de origem — ver `sfx/CREDITS.txt` para a fonte exata de cada arquivo.

Sons **curtos** (menos de ~2s).

| Arquivo            | Dispara quando                    |
|--------------------|------------------------------------|
| `sfx/tap.mp3`      | Avançar uma fala de diálogo        |
| `sfx/select.mp3`   | Clicar num botão/opção             |
| `sfx/correct.mp3`  | Acertar uma pergunta                |
| `sfx/wrong.mp3`    | Errar uma pergunta                  |
| `sfx/gate.mp3`     | Portão abrindo / pedra afundando   |
| `sfx/walk.mp3`     | Passo do personagem (opcional)     |
| `sfx/attack.mp3`   | Ataque do jogador no combate        |
| `sfx/hurt.mp3`     | Jogador leva dano no combate        |
| `sfx/victory.mp3`  | Vencer o combate                    |

Se algum desses arquivos faltar (ou você apagar a pasta), o jogo cai
automaticamente para uma versão **sintetizada em código** equivalente
(`SYNTH_SFX` em `src/game/audio.ts`) — o jogo nunca fica sem som.

---

## Onde achar efeitos grátis (CC0 / domínio público)

- https://kenney.nl/assets?q=audio
- https://freesound.org
- https://pixabay.com/sound-effects/
- https://opengameart.org

## Ajustes

O volume dos efeitos é controlado por `_volume` em `src/game/audio.ts`.
