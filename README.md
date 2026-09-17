<div align="center">
<img width="1200" height="475" alt="Prof. Corujão Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

# Prof. Corujão — IA para Professores Brasileiros

**Assistente pedagógico com IA para professores da educação básica brasileira.**  
Planos de aula BNCC, slides, atividades e provas; jogos ao vivo com a turma; gamificação,
diário de classe e calendário — tudo em português.

[![Deploy](https://img.shields.io/badge/deploy-Firebase-orange?logo=firebase)](https://firebase.google.com/)
[![PWA](https://img.shields.io/badge/PWA-instalável-blue?logo=googlechrome)](https://web.dev/progressive-web-apps/)
[![Gemini](https://img.shields.io/badge/IA-Gemini%203.6%20Flash-purple?logo=google)](https://aistudio.google.com/)
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
- **Exportação** — planos, atividades e provas em Word (.docx); slides em PowerPoint (.pptx)

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

### Atividades lúdicas (IA)
Geradas a partir do tema e do nível da turma, para imprimir ou projetar:
- Quiz
- Caça-palavras
- Palavras cruzadas
- Bingo
- Escape Room temático (Medieval / Laboratório / Detetive / Espaço)
- Jogo da Memória
- Storytelling

A Sequência Didática também pode ser gerada a partir do Estúdio, mas é documento do professor — veja em Planejamento com IA.

### Jogos ao vivo com a turma
Todos rodam numa tela só (projetor ou o celular do professor) — não é cada aluno com o próprio
placar num dispositivo separado:
- **Quiz Relâmpago** — formato de programa de auditório: 10 perguntas geradas por IA sobre o
  tema, 20 segundos por pergunta, suspense de 1,5s antes de revelar a resposta certa, bônus de
  pontos por rapidez e por sequência de acertos.
- **Batalha de Revisão** — duelo por turnos entre duas equipes: cada equipe tem pontos de vida,
  acerto tira vida do adversário (com bônus para quem está perdendo e por resposta rápida), três
  acertos seguidos curam vida. O banco de perguntas pode ser reaproveitado por link ou QR, sem
  gastar IA de novo. Ao final, o professor credita XP para a equipe vencedora.
- **Mundo Perdido** — aventura de escape room com história, cenários e trilha sonora próprios
  (tema de floresta e ecologia), jogada no aparelho de cada aluno com progresso salvo
  automaticamente. O professor pode trocar as perguntas da aventura por um quiz gerado por IA
  sobre o conteúdo da aula, mantendo a mesma história.

### Gamificação de Turma
- Sistema de **XP e moedas** por comportamento e participação, creditado pelo professor
- **Equipes** com personalização de nome, emoji e cor
- **Loja de recompensas** cadastrada pelo professor; o resgate também é feito por ele, debitando
  as moedas do aluno
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

### Biblioteca Compartilhada
- Materiais publicados pela administração, disponíveis para todos os professores
- Upload com título, tipo, disciplina e ano, com medidor do espaço usado

### Chat IA (Corujão)
- Chat pedagógico em português com suporte a anexos (imagens, PDFs)
- Histórico sincronizado no Firestore

### Perfil do Professor
- Foto de perfil (upload via Firebase Storage)
- Nome, escola, área e nível de ensino
- Painel de estatísticas: turmas, materiais e gerações de IA
- Edição de dados e zona de configuração

### Planos — Gratuito e PRO
- Conta gratuita tem limite de gerações de IA; ao atingir o limite, o professor é convidado a virar PRO
- Conta PRO tem gerações ilimitadas
- Liberação e remoção de PRO por professor, feita pela administração no Painel Admin
- Uso de tokens, gerações e custo estimado da IA é registrado por professor e por mês

### Painel Admin
Visível só para a conta administradora:
- **Usuários** — busca, filtros (PRO, gratuito, no limite, admins), liberação de PRO e exportação em CSV
- **Feedbacks** — o que os professores enviam pelo app
- **Biblioteca** — envio e remoção dos materiais compartilhados
- **Métricas** — uso de tokens, gerações e custo estimado da IA por mês, e o Aviso Global (recado que aparece para todo mundo, ligado e desligado por ali)
- **Feriados** — feriados globais, que entram no calendário de todos os professores

### PWA (App instalável)
- Instalável no celular e no computador (Android, iOS, Windows, Mac)
- Notificações push mesmo com o app fechado (Firebase Cloud Messaging)
- Lembrete automático de aula por notificação push, ~30 minutos antes do horário marcado
- Service worker sem precache: cada atualização publicada vale na hora, sem
  precisar limpar o cache e sem baixar megabytes a cada deploy

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Front-end | React 19 + TypeScript 5.8 |
| Estilo | Tailwind CSS 4 |
| Animações | Framer Motion (motion/react) |
| IA | Google Gemini 3.6 Flash (`@google/genai`) |
| Banco de dados | Firebase Firestore (sync em tempo real) |
| Autenticação | Firebase Auth (Google) |
| Armazenamento | Firebase Storage |
| Notificações | Firebase Cloud Messaging (FCM) |
| Imagens | Pixabay API (opcional) / Unsplash fallback |
| Exportação | Word (docx) / PowerPoint (pptxgenjs) |
| Cloud Functions | Firebase Functions (lembrete de aula agendado) |
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
