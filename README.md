<div align="center">
<img width="1200" height="475" alt="Prof. Corujão Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Prof. Corujão — IA para Professores Brasileiros

**Assistente pedagógico com IA para professores da educação básica brasileira.**  
Planos de aula com habilidades da BNCC conferidas contra o dataset oficial,
slides, atividades, provas, jogos, gamificação de turma, diário de classe e
calendário letivo — tudo em português.

[![Deploy](https://img.shields.io/badge/deploy-Firebase-orange?logo=firebase)](https://firebase.google.com/)
[![PWA](https://img.shields.io/badge/PWA-instalável-blue?logo=googlechrome)](https://web.dev/progressive-web-apps/)
[![Gemini](https://img.shields.io/badge/IA-Gemini%202.5%20Flash-purple?logo=google)](https://aistudio.google.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## Funcionalidades

### Planejamento com IA
- **Plano de Aula** — documento completo: área de conhecimento, eixo temático, conteúdos, objetivos, perguntas mobilizadoras, metodologia com os tempos de abertura, desenvolvimento e fechamento calculados pela duração da aula, habilidades da BNCC, recursos, avaliação e referências
- **Slides** — apresentação pronta, com imagens buscadas por tema, paleta derivada de uma cor escolhida pelo professor e editor visual para ajustar cada lâmina
- **Atividades** e **Provas** — exercícios no nível da turma; provas com questões objetivas e discursivas mais gabarito
- **Sequência Didática** — várias aulas encadeadas sobre o mesmo tema
- **Estúdio** — geração em segundo plano, com histórico e contexto de turma

Tom do texto, grau de complexidade, foco pedagógico, número de aulas, duração e
turno são ajustáveis antes de gerar.

### Habilidades da BNCC conferidas
Modelos de linguagem inventam código de habilidade. O plano sai bonito e o
código não existe. Aqui a conferência não depende da IA:

1. O app identifica etapa, ano e disciplina pelo nível e pelo nome da turma
2. Seleciona as aprendizagens reais correspondentes e as injeta no comando
3. Depois da resposta, extrai todos os códigos do texto e compara com o dataset
   oficial — se a IA inventou, esqueceu ou omitiu, a seção é reescrita

São **1.580 aprendizagens vigentes**, das três etapas. Detalhes em
[Dados da BNCC](#dados-da-bncc).

### Ferramentas Pedagógicas
| Ferramenta | Descrição |
|---|---|
| Parecer Descritivo | Pareceres individuais e comentários de boletim, com impressão em papel timbrado |
| Adaptação Inclusiva | Adapta atividades para TDAH, TEA, dislexia, deficiência intelectual, baixa visão, surdez e altas habilidades |
| Rubrica de Avaliação | Critérios e níveis de desempenho para trabalhos e projetos |
| Nivelador de Texto | Reescreve textos no nível de leitura da turma |
| Comunicação com Famílias | Bilhetes, comunicados e mensagens prontas para WhatsApp |
| Material de Vídeo | Transforma vídeos do YouTube em aula e atividades |
| Material do meu PDF | Gera materiais a partir do livro ou apostila do professor |

### Jogos Educativos (IA)
Quiz, caça-palavras, palavras cruzadas, bingo, jogo da memória, sequência
lógica, flashcards, história narrativa e sala de escape — esta em quatro
ambientações: Pergaminho Medieval, Laboratório Científico, Investigação
Detetivesca e Estação Espacial. Todas exportáveis para impressão.

A IA fornece o conteúdo; a estrutura é montada pelo próprio app. O encaixe das
palavras na grade e o sorteio das cartelas seguem algoritmos próprios, então o
jogo sempre sai jogável.

### Mundo Perdido
Jogo narrativo em tela cheia, com trilha sonora e centenas de cenários. Um
estudante adormece a três dias da prova final e acorda num jardim que só abre
passagem quando ele acerta perguntas sobre plantas. Enigmas de botânica,
escolhas que mudam as reações dos personagens e um final que o jogador decide.
O professor pode gerar o próprio conjunto de perguntas e compartilhar a partida.

### Jogos de Competição em Turma
- **Batalha de Equipes** — combate por acertos
- **O Milhão** — escada de prêmios com patamares de segurança
- **Leilão do Saber** — as equipes apostam pontos antes de saber se acertaram
- **Quiz Relâmpago** — dez rodadas rápidas, com cenário animado e personagem que reage a cada resposta

As perguntas são geradas pela disciplina e nível da turma, e os pontos viram
experiência na gamificação.

### Instrumentos para Conduzir a Aula
Sorteador de alunos, cronômetro, formador automático de grupos, medidor de
ruído da sala, semáforo de comportamento, dado virtual e placar de equipes.

### Gamificação de Turma
- **XP e moedas** por comportamentos que o professor configura — participar, ajudar um colega e entregar a tarefa somam; atrapalhar a aula desconta
- **Seis níveis**: Aprendiz, Explorador, Estudioso, Sábio, Mestre e Lenda, a partir de 0, 40, 100, 200, 320 e 480 pontos
- **Medalhas** por marcos, incluindo sequências de dias seguidos pontuando
- **Loja de recompensas** propositalmente não material: ajudante do dia, escolher a música da aula, mensagem positiva para casa, um dia a mais no prazo
- **Equipes**, **missões semanais** com meta e prêmio, e **temporadas** encerráveis com registro no Hall da Fama
- Histórico completo das ações e cadastro em massa de alunos
- Dois conjuntos visuais: Coruja e Emblema

### Gestão de Turmas
- Cadastro de turmas com dias da semana e **horários reais por dia**
- Cores personalizadas e perfil de turma (nível, escola, turno)
- Sincronização em tempo real via Firestore

### Calendário & Importação por PDF
- Calendário mensal com eventos, feriados e aulas
- **Importação de Calendário Letivo via PDF** — a IA extrai todos os feriados, recessos, reuniões e eventos
- **Importação de Ementa via PDF** — a IA lê os módulos e distribui as aulas no calendário pelos dias da turma
- Detalhe diário com listagem de aulas e eventos
- Feriados nacionais calculados para qualquer ano, incluindo as datas móveis
  que dependem da Páscoa

### Diário de Bordo
- Registro de **chamada/frequência** por aula (Presente / Falta / Atestado)
- Campo de **notas** por encontro
- Registro de **conceitos/notas** por aluno
- Sincronizado via Firestore por turma

### Acervo de Materiais
- Biblioteca pessoal do que foi gerado, com busca por título e filtro por tipo
- Acervo compartilhado com materiais curados pela administração
- Exportação em **Word** e **PowerPoint**, e layouts de impressão feitos para
  cada tipo de conteúdo: plano de aula, parecer com campo de assinatura,
  bilhete para a família, lista de chamada, cartelas de bingo e caderno da sala
  de escape

### Chat IA (Corujão)
- Chat pedagógico em português com suporte a anexos (imagens, PDFs)
- Histórico sincronizado no Firestore

### Perfil do Professor
- Foto de perfil (upload via Firebase Storage)
- Nome, escola, área e nível de ensino
- Painel de estatísticas: turmas, materiais e gerações de IA
- Teste gratuito de 7 dias e ativação do plano Pro
- **Lembrete de aula** no celular cerca de 30 minutos antes, mesmo com o app
  fechado, respeitando o fuso horário do professor
- Edição de dados e zona de configuração

### PWA (App instalável)
- Instalável no celular e no computador (Android, iOS, Windows, Mac)
- Service worker com cache de ativos estáticos
- A **interface** abre offline; os **dados** (turmas, planos, diário) exigem
  conexão — o Firestore roda sem persistência local por enquanto

---

## Planos

| Plano | O que inclui |
|---|---|
| **Teste gratuito** | **7 dias** a partir do cadastro, com criação ilimitada de planos, atividades, provas, slides, jogos e materiais |
| **Pro** | Criação ilimitada sem prazo — ativado via WhatsApp |

O teste começa na data de cadastro (`createdAt` do perfil), que as regras do
Firestore tornam imutável para o próprio usuário. Quando o prazo termina, o
professor continua acessando o perfil e **todo o material já criado** — só a
geração de conteúdo novo fica bloqueada.

> A contagem é feita no cliente. Como as chamadas de IA saem do navegador (ver
> `SECURITY-ANALYSIS.md`), a validação forte do prazo exigiria um backend.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Front-end | React 19 + TypeScript 5.8 |
| Estilo | Tailwind CSS 4 |
| Animações | Framer Motion (motion/react) |
| IA | Google Gemini 2.5 Flash (`@google/genai`) |
| Banco de dados | Firebase Firestore (sync em tempo real) |
| Autenticação | Firebase Auth (e-mail e senha) |
| Armazenamento | Firebase Storage |
| Notificações | Firebase Cloud Messaging (FCM) |
| Imagens | Pixabay API (opcional) / Unsplash fallback |
| Exportação | `docx`, `pptxgenjs`, `jszip` |
| Currículo | Dataset BNCC com 1.580 aprendizagens, carregado sob demanda |
| Build | Vite 6 + vite-plugin-pwa |
| Deploy | Firebase Hosting / Vercel / Cloud Run |

---

## Como Rodar Localmente

**Pré-requisitos:** Node.js 18+

```bash
# 1. Clone o repositório
git clone https://github.com/anonimo78129-sys/Prof.-Coruj-o.git
cd Prof.-Coruj-o

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env.local
# Edite .env.local e adicione sua GEMINI_API_KEY

# 4. Inicie o servidor de desenvolvimento
npm run dev
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GEMINI_API_KEY` | Sim | Chave da API do Google Gemini — [obter em aistudio.google.com](https://aistudio.google.com/apikey) |
| `PIXABAY_API_KEY` | Não | Imagens nos slides — [obter em pixabay.com/api/docs](https://pixabay.com/api/docs/) |

---

## Configuração do Firebase

O arquivo `firebase-applet-config.json` na raiz contém a configuração do projeto Firebase (já incluso). Para usar seu próprio projeto Firebase:

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com/)
2. Ative **Authentication** (e-mail/senha), **Firestore**, **Storage** e **Cloud Messaging**
3. Substitua o conteúdo de `firebase-applet-config.json` com os dados do seu projeto
4. Publique as regras: `firebase deploy --only firestore:rules,storage:rules`

---

## Build para Produção

```bash
npm run build
# Saída em /dist — pode ser publicada em qualquer CDN estático
```

---

## Testes

```bash
npm test        # roda a suíte
npm run lint    # checagem de tipos (tsc) + eslint
```

A suíte cobre as funções puras do app — com destaque para a **validação
determinística das habilidades da BNCC** (`src/bncc-data.ts`), que confere os
códigos devolvidos pela IA contra o dataset oficial e reescreve a seção quando
a IA inventa, esquece ou omite habilidades.

---

## Dados da BNCC

O app ancora os planos de aula em **1.580 aprendizagens oficiais vigentes**:

| Etapa | Cobertura |
|---|---|
| Educação Infantil | 93 objetivos de aprendizagem (`EI01CG01`…) |
| Ensino Fundamental | 1.304 habilidades (`EF01LP01`, `EF15LP01`, `EF67LP08`…) |
| Ensino Médio | 183 habilidades (`EM13CNT101`, `EM13LP01`…) |

O arquivo `src/bncc-dataset.ts` é **gerado**, não editado à mão. Para regerar:

```bash
python3 scripts/gerar-bncc-dataset.py
```

Ele é carregado por **import dinâmico** — vira um bloco separado de ~96 KB
comprimido, fora do primeiro carregamento do app.

### Como a ancoragem funciona

1. O app identifica **etapa, ano e disciplina** a partir do nível e do nome da
   turma (aceita `9º B`, `3º A`, `2ª série`, `Maternal II`).
2. Seleciona as aprendizagens reais mais próximas do tópico da aula e as injeta
   no comando enviado à IA.
3. Depois da resposta, **confere os códigos** contra o dataset e reescreve a
   seção se a IA inventou, esqueceu ou omitiu algum.

Quando a etapa não pode ser inferida, ou a disciplina não existe naquela etapa
(Ensino Religioso não tem Ensino Médio), o app **não ancora nada** — é melhor
deixar a IA escolher do que fixar um código da série errada.

### Crédito

Dados extraídos de [bncc-dev/bncc-dados](https://github.com/bncc-dev/bncc-dados)
(licença **CC BY 4.0**), que compila as planilhas oficiais de
[downloadbncc.mec.gov.br](https://downloadbncc.mec.gov.br/) e as verifica
caractere a caractere contra o PDF homologado da BNCC (MEC, 2018).

---

## Licença

Projeto de uso educacional. Desenvolvido com ❤️ para professores brasileiros.

Os dados da BNCC embutidos em `src/bncc-dataset.ts` são de terceiros e seguem a
licença **CC BY 4.0** — veja o [crédito](#crédito) acima.
