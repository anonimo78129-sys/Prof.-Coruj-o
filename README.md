<div align="center">
<img width="1200" height="475" alt="Prof. Corujão Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Prof. Corujão — IA para Professores Brasileiros

**Assistente pedagógico com IA para professores da educação básica brasileira.**  
Planos de aula BNCC, slides, atividades, gamificação de turma, diário de classe e muito mais — tudo em português.

[![Deploy](https://img.shields.io/badge/deploy-Firebase-orange?logo=firebase)](https://firebase.google.com/)
[![PWA](https://img.shields.io/badge/PWA-instalável-blue?logo=googlechrome)](https://web.dev/progressive-web-apps/)
[![Gemini](https://img.shields.io/badge/IA-Gemini%202.5%20Flash-purple?logo=google)](https://aistudio.google.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## Funcionalidades

### Planejamento com IA
- **Plano de Aula** — gera planos completos alinhados à BNCC com objetivos, metodologia, recursos e avaliação
- **Slides** — apresentações prontas com imagens do Pixabay e design responsivo
- **Atividades** — exercícios e tarefas personalizadas por turma e nível
- **Provas** — questões objetivas e discursivas com gabarito
- **Sequência Didática** — sequências completas com múltiplas aulas
- **Estúdio** — chat avançado com histórico, contexto de turma e geração de materiais em múltiplas etapas

### Ferramentas Pedagógicas
| Ferramenta | Descrição |
|---|---|
| Parecer Descritivo | Comentários de boletim e pareceres individuais por aluno |
| Adaptação Inclusiva | Adapta atividades para TEA, TDAH, dislexia e outras necessidades |
| Rubrica de Avaliação | Critérios e níveis prontos para qualquer trabalho ou projeto |
| Nivelador de Texto | Reescreve textos no nível de leitura da turma |
| Comunicação com Famílias | Bilhetes, comunicados e mensagens prontas para WhatsApp |
| Material de Vídeo | Transforma vídeos do YouTube em aula e atividades |
| Material do meu PDF | Gera materiais a partir do seu livro ou apostila |

### Jogos Educativos (IA)
- Quiz interativo
- Caça-palavras
- Palavras cruzadas
- Bingo
- Escape Room temático (Medieval / Laboratório / Detetive / Espaço)
- Jogo da Memória
- Sequência (ordenar eventos/etapas)
- Flashcards
- Jogo de história narrativa

### Gamificação de Turma
- Sistema de **XP e moedas** por comportamento e participação
- **Equipes** com personalização de nome, emoji e cor
- **Missões semanais** com meta e recompensa configurável
- **Loja de recompensas** onde alunos trocam moedas por prêmios
- **Hall da Fama** com pódio dos melhores alunos por temporada
- Log de todas as ações (pontuação, compras, recompensas)
- Suporte a cadastro em massa de alunos
- Dois temas visuais: Coruja e Emblema

### Gestão de Turmas
- Cadastro de turmas com dias da semana e **horários reais por dia**
- Cores personalizadas e perfil de turma (nível, escola, turno)
- Sincronização em tempo real via Firestore

### Calendário & Importação por PDF
- Calendário mensal com eventos, feriados e aulas
- **Importação de Calendário Letivo via PDF** — a IA extrai todos os feriados, recessos, reuniões e eventos
- **Importação de Ementa via PDF** — a IA lê os módulos e distribui as aulas no calendário pelos dias da turma
- Detalhe diário com listagem de aulas e eventos

### Diário de Bordo
- Registro de **chamada/frequência** por aula (Presente / Falta / Atestado)
- Campo de **notas** por encontro
- Registro de **conceitos/notas** por aluno
- Sincronizado via Firestore por turma

### Acervo de Materiais
- Biblioteca pessoal de tudo que foi gerado (slides, atividades, planos, provas)
- Busca por título e filtro por tipo
- Remoção com confirmação

### Chat IA (Corujão)
- Chat pedagógico em português com suporte a anexos (imagens, PDFs)
- Histórico sincronizado no Firestore

### Perfil do Professor
- Foto de perfil (upload via Firebase Storage)
- Nome, escola, área e nível de ensino
- Painel de estatísticas: turmas, materiais e gerações de IA
- Edição de dados e zona de configuração

### PWA (App instalável)
- Instalável no celular e no computador (Android, iOS, Windows, Mac)
- Notificações push mesmo com o app fechado (Firebase Cloud Messaging)
- Service worker sem precache: cada atualização publicada vale na hora, sem
  precisar limpar o cache e sem baixar megabytes a cada deploy

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Front-end | React 19 + TypeScript 5.8 |
| Estilo | Tailwind CSS 4 |
| Animações | Framer Motion (motion/react) |
| IA | Google Gemini 2.5 Flash (`@google/genai`) |
| Banco de dados | Firebase Firestore (sync em tempo real) |
| Autenticação | Firebase Auth (Google) |
| Armazenamento | Firebase Storage |
| Notificações | Firebase Cloud Messaging (FCM) |
| Imagens | Pixabay API (opcional) / Unsplash fallback |
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
2. Ative **Authentication** (Google), **Firestore**, **Storage** e **Cloud Messaging**
3. Substitua o conteúdo de `firebase-applet-config.json` com os dados do seu projeto
4. Publique as regras: `firebase deploy --only firestore:rules,storage:rules`

---

## Build para Produção

```bash
npm run build
# Saída em /dist — pode ser publicada em qualquer CDN estático
```

---

## Licença

Projeto de uso educacional. Desenvolvido com ❤️ para professores brasileiros.
