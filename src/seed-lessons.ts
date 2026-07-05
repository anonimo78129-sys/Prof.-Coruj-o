// ─── Admin seed data: ementas das turmas pré-definidas ──────────────────────
// Dados puros usados pelo botão "Importar turmas" do admin.

export const INFORMATICA_LESSONS: { title: string; topic: string }[] = [
  // Estrutura SEGUE A PLANILHA_LYELSON à risca: 38 aulas, na ordem/contagem exata da planilha.
  // IPD(1) → Windows(7) → Digitação(4) → Word(6) → Excel(6) → PowerPoint(5) → Power BI(5) → Internet(4)
  // O conteúdo de cada aula vem da EMENTA Informática (condensado para caber nos slots da planilha).
  // IPD (1 aula) — índice 0
  { title: 'IPD: Introdução ao Processamento de Dados', topic: 'O que é Informática? História e evolução. Componentes de um computador: Hardware e Software.' },
  // Windows (7 aulas) — índices 1-7
  { title: 'Windows: Tipos de computadores', topic: 'Tipos de computadores: Desktops, Laptops, Tablets, Smartphones.' },
  { title: 'Windows: Componentes do computador', topic: 'Componentes básicos de um computador (CPU, Monitor, Teclado, Mouse, etc.).' },
  { title: 'Windows: Sistema Operacional e área de trabalho', topic: 'O que é um Sistema Operacional? Funções e importância. A área de trabalho: ícones, barra de tarefas e menu iniciar.' },
  { title: 'Windows: Atividade prática', topic: 'Atividade prática sobre o sistema operacional e a área de trabalho.' },
  { title: 'Windows: Painel de controle e arquivos', topic: 'Painel de controle: configurações de data e hora, idioma e teclado. Explorador de arquivos: criar, copiar, mover, renomear e excluir arquivos/pastas.' },
  { title: 'Windows: Revisão', topic: 'Revisão dos conceitos de sistema operacional, painel de controle e gerenciamento de arquivos.' },
  { title: 'Windows: Prova', topic: 'Prova do módulo de Fundamentos da Informática e Sistema Operacional.' },
  // Digitação (4 aulas) — índices 8-11
  { title: 'Digitação: Conhecendo o teclado', topic: 'Conhecendo o teclado e o posicionamento correto das mãos e dedos.' },
  { title: 'Digitação: Linha base (ASDF JKLÇ)', topic: 'Foco nas letras da linha base (ASDF JKLÇ).' },
  { title: 'Digitação: Reprodução e memorização', topic: 'Exercícios de reprodução e memorização.' },
  { title: 'Digitação: Prática intensiva', topic: 'Exercícios de datilografia para prática intensiva. Posicionamento correto das mãos e dedos no teclado.' },
  // Word (6 aulas) — índices 12-17 (Turma 5 começa aqui)
  { title: 'Word: Introdução e interface', topic: 'Introdução ao Word: interface, menu e barra de ferramentas.' },
  { title: 'Word: Criação e formatação de documentos', topic: 'Criação, edição e formatação de documentos. Inserção de imagens, tabelas e gráficos. Atividade prática.' },
  { title: 'Word: Estilos e revisão de texto', topic: 'Estilos, formatação de parágrafos e fontes. Cabeçalho, revisão ortográfica e gramatical.' },
  { title: 'Word: Tabelas', topic: 'Criação e formatação de tabelas. Atividades práticas.' },
  { title: 'Word: Revisão', topic: 'Revisão dos conceitos do módulo Word.' },
  { title: 'Word: Prova', topic: 'Prova do módulo Word.' },
  // Excel (6 aulas) — índices 18-23 (Turma 3 começa na 2ª aula, índice 19)
  { title: 'Excel: Introdução a planilhas', topic: 'Introdução ao Excel: planilhas, células, linhas e colunas.' },
  { title: 'Excel: Inserção e formatação de dados', topic: 'Inserção e formatação de dados.' },
  { title: 'Excel: Fórmulas básicas', topic: 'Fórmulas básicas: soma, média, máximo e mínimo.' },
  { title: 'Excel: Funções, gráficos e formatação condicional', topic: 'Funções: condição (SE) e pesquisa. Criação de gráficos. Formatação condicional.' },
  { title: 'Excel: Exercícios práticos e revisão', topic: 'Exercícios: planilha de orçamento pessoal e controle de estoque, praticando a digitação de números e símbolos. Revisão.' },
  { title: 'Excel: Prova', topic: 'Prova do módulo Excel.' },
  // PowerPoint (5 aulas) — índices 24-28
  { title: 'PowerPoint: Introdução e slides', topic: 'Introdução ao PowerPoint: criação de apresentações e slides.' },
  { title: 'PowerPoint: Texto, mídia e design', topic: 'Inserção de texto, imagens, vídeos e áudios. Design de slides: temas, cores e fontes.' },
  { title: 'PowerPoint: Transições e animações', topic: 'Transições e animações.' },
  { title: 'PowerPoint: Apresentação e exercícios', topic: 'Apresentação de slides: modos de exibição e navegação. Exercício: criação de apresentação sobre tema livre e apresentação em sala.' },
  { title: 'PowerPoint: Revisão e prova', topic: 'Revisão dos conceitos e prova do módulo PowerPoint.' },
  // Power BI (5 aulas) — índices 29-33
  { title: 'Power BI: Introdução', topic: 'O que é o Power BI, importância e aplicações no mercado. Visão geral da interface e principais ferramentas, conectando-se a fontes de dados.' },
  { title: 'Power BI: Modelagem de dados', topic: 'Conceito de modelagem de dados, relacionamentos entre tabelas, normalização e boas práticas. Criação de colunas e medidas.' },
  { title: 'Power BI: Gráficos e dashboards', topic: 'Tipos de gráficos e quando usá-los. Formatação e personalização de dashboards, uso de filtros e segmentações, criando painéis interativos.' },
  { title: 'Power BI: DAX', topic: 'O que é DAX e para que serve. Principais funções do DAX, criando medidas e colunas calculadas, aplicação de cálculos básicos.' },
  { title: 'Power BI: Revisão e prova', topic: 'Revisão dos conceitos abordados, exercícios práticos com desafios reais e prova do módulo Power BI.' },
  // Internet (4 aulas) — índices 34-37
  { title: 'Internet: Introdução e navegadores', topic: 'O que é a Internet? História e evolução. Navegadores: Chrome, Firefox, Edge, etc.' },
  { title: 'Internet: Endereços web e domínios', topic: 'Endereços web (URLs) e domínios.' },
  { title: 'Internet: Navegação e pesquisa', topic: 'Exercícios: navegação na Internet, pesquisa de informações online e prática de digitação de URLs e termos de pesquisa.' },
  { title: 'Internet: E-mail e revisão final', topic: 'Criação e gerenciamento de contas de e-mail. Revisão geral e prova final do curso.' },
];

export const JOGOS_LESSONS: { title: string; topic: string }[] = [
  { title: 'Aula 1: Boas-vindas ao Mundo dos Games!', topic: 'Exploração dos exemplos de jogos no GDevelop. Brainstorm de ideias de jogos.' },
  { title: 'Aula 2: Criando o Seu Mundo', topic: 'Sprites, chão e cenário. Design de estrutura com objetos de plataforma.' },
  { title: 'Aula 3: Dando Vida com Comportamentos', topic: 'Movimentação básica. Comportamento de plataforma: velocidade, pulo, gravidade.' },
  { title: 'Aula 4: A Câmera e os Limites do Mundo', topic: 'Controle da visão do jogador. Expansão de fase. Parallax com camadas.' },
  { title: 'Aula 5: A Lógica por Trás de Tudo — Eventos', topic: 'Primeira interação. Múltiplos coletáveis e feedback visual.' },
  { title: 'Aula 6: Variáveis — Guardando Informações', topic: 'Sistema de Vidas. Contador de moedas na tela. Armazenamento de pontuação.' },
  { title: 'Aula 7: Interface do Usuário (UI)', topic: 'Botões com feedback. Fontes customizadas. Exibição de pontuação na tela.' },
  { title: 'Aula 8: Inimigos Simples e Condição de Perder', topic: 'Movimento de inimigo (vai e vem). Múltiplos inimigos. Condição de derrota.' },
  { title: 'Revisão do Módulo 1 (Aulas 1 a 8)', topic: 'Tira-dúvidas e reforço de objetos, comportamentos, eventos e variáveis.' },
  { title: 'Prova Prática 1', topic: 'Criar uma cena funcional aplicando os conceitos do Módulo 1.' },
  { title: 'Aula 9: Projeto 1 — Planejamento', topic: 'Detalhando o Game Design Document (GDD) com história e mecânicas do jogo.' },
  { title: 'Aula 10: Construindo a Fase', topic: 'Fase principal do jogo. Áreas secretas e elementos decorativos.' },
  { title: 'Aula 11: Implementando a Condição de Vitória', topic: 'Múltiplos níveis. Portão para Fase 2. Tela de Vitória personalizada.' },
  { title: 'Aula 12: Telas de Início e Fim', topic: 'Música no menu. Botões de créditos. Transições de cena com fade.' },
  { title: 'Aula 13: Aprofundando — Sons e Músicas', topic: 'Busca de assets de sons gratuitos. Trilha sonora completa para o jogo.' },
  { title: 'Aula 14: Aprofundando — Animações', topic: 'Animação de ataque/dano no personagem. Animação simples para inimigos.' },
  { title: 'Aula 15: Aprofundando — Timers e Spawners', topic: 'Inimigos em locais aleatórios. Itens temporários que somem após segundos.' },
  { title: 'Aula 16: Polimento e Desafio Criativo', topic: 'Mini Game Jam: criar protótipo em 30 minutos com tema dado.' },
  { title: 'Revisão do Módulo 2 (Aulas 9 a 16)', topic: 'Revisão de estrutura de projetos, polimento e conceitos avançados.' },
  { title: 'Prova Prática 2', topic: 'Aprimorar um projeto existente com som, animação e novo desafio criativo.' },
  { title: 'Aula 17: Projeto 2 — Top-Down Shooter', topic: 'Nova mecânica de jogo. Inimigo com comportamento Pathfinding.' },
  { title: 'Aula 18: Atirando Projéteis', topic: 'Tipos de tiro, tiro carregado. Destruição de projéteis fora da tela.' },
  { title: 'Aula 19: Inimigos em Ondas', topic: 'Ondas progressivas de inimigos. Chefe simples com mais vida.' },
  { title: 'Aula 20: Destruindo Inimigos e Pontuando', topic: 'Sistema de Combo. Feedback de dano. Loop principal de gameplay.' },
  { title: 'Aula 21: Power-ups e Efeitos Visuais', topic: 'Power-up de escudo e velocidade. Efeitos de rastro com partículas.' },
  { title: 'Aula 22: Montando o Jogo Completo', topic: 'High Score com salvamento. Polimento final e feedback entre alunos.' },
  { title: 'Aula 23: Exportando e Compartilhando', topic: 'Exportação para Desktop. Criar página no itch.io para hospedar o jogo.' },
  { title: 'Aula 24: Apresentação Final e Próximos Passos', topic: 'Portfólio: como usar os jogos criados. Continuidade após o curso.' },
  { title: 'Revisão Final e Preparação', topic: 'Polimento do projeto final para a apresentação.' },
  { title: 'Apresentação Final dos Projetos', topic: 'Cada aluno apresenta seu melhor jogo explicando conceito e mecânicas.' },
];
