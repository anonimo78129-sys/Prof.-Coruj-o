// Banco de habilidades BNCC — Ensino Fundamental (EF) e Ensino Médio (EM)
// Fonte: Base Nacional Comum Curricular (MEC, 2017/2018)

export interface BnccSkill {
  code: string;
  desc: string;
  tags: string[];
}

export interface BnccBlock {
  label: string;
  gradeKeys: string[]; // tokens para detectar a série/nível
  skills: BnccSkill[];
}

export interface BnccSubject {
  names: string[]; // variações do nome da disciplina
  blocks: BnccBlock[];
}

// ── Banco de dados ────────────────────────────────────────────────────────────
export const bnccData: BnccSubject[] = [
  // ─── LÍNGUA PORTUGUESA ────────────────────────────────────────────────────
  {
    names: ['língua portuguesa', 'lingua portuguesa', 'português', 'portugues', 'lp'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01LP01', desc: 'Reconhecer que textos são lidos e escritos da esquerda para a direita e de cima para baixo', tags: ['leitura', 'escrita', 'alfabetização', 'texto', 'direção'] },
          { code: 'EF02LP01', desc: 'Utilizar grafia correta de palavras conhecidas ou com estruturas silábicas já estudadas', tags: ['ortografia', 'escrita', 'gramática', 'sílaba', 'palavra'] },
          { code: 'EF03LP04', desc: 'Identificar e reproduzir, em textos, palavras e expressões que indicam ironia e humor', tags: ['ironia', 'humor', 'leitura', 'compreensão', 'interpretação'] },
          { code: 'EF04LP01', desc: 'Ler e compreender, com certa autonomia, cartas pessoais de reclamação e outros gêneros cotidianos', tags: ['leitura', 'gêneros textuais', 'carta', 'cotidiano'] },
          { code: 'EF04LP05', desc: 'Selecionar fatos relevantes e palavras adequadas para referenciar pessoas e objetos nos textos produzidos', tags: ['produção textual', 'coesão', 'referenciação', 'escrita'] },
          { code: 'EF05LP01', desc: 'Inferir informações implícitas nos textos lidos', tags: ['inferência', 'leitura', 'interpretação', 'compreensão', 'implícito'] },
          { code: 'EF05LP07', desc: 'Inferir e justificar, por meio de troca oral, os efeitos de ironia e humor em textos lidos', tags: ['ironia', 'humor', 'oralidade', 'interpretação', 'discussão'] },
          { code: 'EF05LP19', desc: 'Reconhecer e usar os dois-pontos, o ponto-e-vírgula e a vírgula nas situações em que são necessários', tags: ['pontuação', 'gramática', 'escrita', 'sintaxe'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06LP01', desc: 'Identificar em textos o uso de recursos de coesão referencial (pronomes, sinônimos, hiperônimos)', tags: ['coesão', 'referenciação', 'gramática', 'pronomes', 'sinonímia'] },
          { code: 'EF06LP05', desc: 'Identificar e analisar afirmações vagas, generalizações indevidas e argumentos ad hominem em textos argumentativos', tags: ['argumentação', 'análise crítica', 'retórica', 'debate', 'falácia'] },
          { code: 'EF07LP01', desc: 'Identificar, em textos, os períodos e as orações que os constituem, reconhecendo-as como unidades de sentido', tags: ['período', 'oração', 'sintaxe', 'gramática', 'análise sintática'] },
          { code: 'EF08LP01', desc: 'Identificar efeitos de sentido decorrentes de escolhas lexicais e de recursos de coesão sequencial e referencial em textos lidos', tags: ['efeitos de sentido', 'léxico', 'coesão', 'leitura', 'análise'] },
          { code: 'EF08LP08', desc: 'Identificar os mecanismos de modalização e polifonia usados para incluir ou ocultar o ponto de vista do autor', tags: ['modalização', 'polifonia', 'autor', 'ponto de vista', 'discurso'] },
          { code: 'EF09LP01', desc: 'Identificar os efeitos de sentido provocados pelo uso de recursos linguísticos e multissemióticos em textos', tags: ['multissemiose', 'linguagem', 'efeitos de sentido', 'multimodalidade'] },
          { code: 'EF09LP10', desc: 'Elaborar e defender propostas de intervenção para problemas socioculturais, incluindo a posição do autor', tags: ['produção textual', 'argumentação', 'proposta de intervenção', 'redação'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13LGG101', desc: 'Compreender e analisar processos de produção e circulação de discursos em diferentes línguas, mídias e culturas', tags: ['discurso', 'mídia', 'linguagem', 'cultura', 'análise'] },
          { code: 'EM13LGG201', desc: 'Compreender e analisar textos em diferentes linguagens e mídias, ampliando a construção de repertório sociocultural', tags: ['texto', 'leitura', 'repertório', 'cultura', 'mídia'] },
          { code: 'EM13LGG301', desc: 'Utilizar diferentes linguagens para se expressar e partilhar experiências, ideias e sentimentos em diferentes contextos', tags: ['expressão', 'comunicação', 'linguagem', 'produção textual'] },
          { code: 'EM13LGG401', desc: 'Compreender as línguas como fenômeno variável e dinâmico, reconhecendo preconceitos linguísticos', tags: ['variação linguística', 'preconceito', 'diversidade', 'língua'] },
        ],
      },
    ],
  },

  // ─── MATEMÁTICA ──────────────────────────────────────────────────────────
  {
    names: ['matemática', 'matematica', 'mat', 'ma'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01MA01', desc: 'Utilizar números naturais como indicador de quantidade ou de ordem em diferentes situações cotidianas', tags: ['números naturais', 'contagem', 'quantidade', 'ordem', 'cotidiano'] },
          { code: 'EF01MA11', desc: 'Descrever e representar a posição ou movimentação de pessoas/objetos no espaço, por meio de desenhos e esquemas', tags: ['geometria', 'espaço', 'posição', 'localização', 'figuras'] },
          { code: 'EF02MA01', desc: 'Comparar e ordenar números naturais até a ordem de centenas pela compreensão do sistema de numeração decimal', tags: ['números', 'ordem', 'comparação', 'centenas', 'numeração'] },
          { code: 'EF03MA07', desc: 'Resolver e elaborar problemas de multiplicação e divisão, utilizando diferentes estratégias de cálculo', tags: ['multiplicação', 'divisão', 'operações', 'problemas', 'cálculo'] },
          { code: 'EF04MA01', desc: 'Ler, escrever e ordenar números naturais até a ordem de dezenas de milhar e compreender o valor posicional dos algarismos', tags: ['números', 'valor posicional', 'milhar', 'leitura', 'escrita'] },
          { code: 'EF05MA01', desc: 'Ler, escrever e ordenar números racionais na forma decimal com compreensão do sistema de numeração', tags: ['decimais', 'frações', 'números racionais', 'vírgula', 'numeração'] },
          { code: 'EF05MA10', desc: 'Concluir, por meio de investigações, que figuras de mesma forma e tamanhos diferentes podem ter a mesma área', tags: ['área', 'geometria', 'figuras planas', 'semelhança', 'investigação'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06MA01', desc: 'Comparar, ordenar, ler e escrever números inteiros (negativos) e racionais em contextos variados', tags: ['inteiros', 'negativos', 'racionais', 'comparação', 'números'] },
          { code: 'EF06MA12', desc: 'Resolver e elaborar problemas que envolvam porcentagem em contextos financeiros e cotidianos', tags: ['porcentagem', 'financeiro', 'cotidiano', 'problemas', 'desconto'] },
          { code: 'EF07MA01', desc: 'Resolver e elaborar problemas com números racionais, envolvendo as quatro operações e potenciação', tags: ['racionais', 'frações', 'operações', 'potenciação', 'problemas'] },
          { code: 'EF07MA15', desc: 'Realizar ampliações e reduções de figuras geométricas planas e reconhecer as relações de semelhança', tags: ['geometria', 'semelhança', 'ampliação', 'redução', 'figuras'] },
          { code: 'EF08MA06', desc: 'Resolver e elaborar problemas envolvendo cálculo do valor numérico de expressões algébricas', tags: ['álgebra', 'expressões algébricas', 'equações', 'variável', 'cálculo'] },
          { code: 'EF08MA13', desc: 'Resolver e elaborar problemas de estatística envolvendo medidas de tendência central (média, moda, mediana)', tags: ['estatística', 'média', 'moda', 'mediana', 'dados'] },
          { code: 'EF09MA01', desc: 'Reconhecer e empregar notação científica para expressar números muito grandes ou muito pequenos', tags: ['notação científica', 'potenciação', 'números grandes', 'ciências'] },
          { code: 'EF09MA09', desc: 'Compreender os processos de fatoração de expressões algébricas, com base em suas relações com os produtos notáveis', tags: ['fatoração', 'produtos notáveis', 'álgebra', 'expressões', 'polinômios'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13MAT101', desc: 'Interpretar situações econômicas, sociais e das Ciências da Natureza que envolvam a variação de grandezas', tags: ['funções', 'grandezas', 'variação', 'gráficos', 'cotidiano'] },
          { code: 'EM13MAT201', desc: 'Propor ou participar de ações adequadas às demandas da sociedade, envolvendo medidas, grandezas e informações numéricas', tags: ['medidas', 'grandezas', 'estatística', 'probabilidade'] },
          { code: 'EM13MAT301', desc: 'Resolver e elaborar problemas de natureza geométrica, usando retas, ângulos, triângulos, quadriláteros e círculos', tags: ['geometria', 'triângulos', 'polígonos', 'círculo', 'ângulos'] },
          { code: 'EM13MAT401', desc: 'Compreender e utilizar, com flexibilidade e precisão, o processo de construção do conhecimento matemático', tags: ['demonstração', 'raciocínio', 'lógica', 'prova matemática'] },
        ],
      },
    ],
  },

  // ─── CIÊNCIAS ─────────────────────────────────────────────────────────────
  {
    names: ['ciências', 'ciencias', 'ciências naturais', 'ciencias naturais', 'ci'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01CI01', desc: 'Comparar características de diferentes materiais presentes em objetos cotidianos, discutindo origin e impacto do descarte', tags: ['materiais', 'propriedades', 'cotidiano', 'lixo', 'sustentabilidade'] },
          { code: 'EF02CI01', desc: 'Identificar de onde vêm os alimentos consumidos pela família e o caminho que percorrem até a mesa', tags: ['alimentação', 'alimentos', 'origem', 'nutrição', 'saúde'] },
          { code: 'EF03CI01', desc: 'Produzir diferentes sons a partir da vibração de objetos e identificar variáveis que influem nesse fenômeno', tags: ['som', 'vibração', 'acústica', 'onda', 'física'] },
          { code: 'EF04CI01', desc: 'Identificar misturas na vida cotidiana com base em suas propriedades físicas observáveis', tags: ['misturas', 'propriedades', 'matéria', 'química', 'cotidiano'] },
          { code: 'EF04CI11', desc: 'Analisar e construir cadeias alimentares simples, reconhecendo a posição do ser humano nessas cadeias', tags: ['cadeia alimentar', 'ecologia', 'ser vivo', 'predador', 'presa'] },
          { code: 'EF05CI04', desc: 'Identificar os principais usos da água e como ela é distribuída, armazenada e conservada', tags: ['água', 'recursos naturais', 'preservação', 'ciclo da água', 'consumo'] },
          { code: 'EF05CI07', desc: 'Aplicar os conhecimentos sobre as formas de propagação do calor para avaliar situações problema', tags: ['calor', 'propagação', 'condução', 'convecção', 'irradiação', 'física'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06CI01', desc: 'Classificar como homogêneas e heterogêneas misturas envolvendo diferentes materiais do cotidiano', tags: ['misturas', 'química', 'homogênea', 'heterogênea', 'substâncias'] },
          { code: 'EF06CI05', desc: 'Explicar a organização básica das células e seu papel como unidade estrutural e funcional dos seres vivos', tags: ['célula', 'biologia', 'ser vivo', 'membrana', 'organelas'] },
          { code: 'EF07CI01', desc: 'Discutir a aplicação de propriedades dos materiais como densidade, condutibilidade térmica e elétrica', tags: ['densidade', 'condutibilidade', 'propriedades', 'física', 'materiais'] },
          { code: 'EF07CI07', desc: 'Caracterizar os principais ecossistemas brasileiros quanto à biodiversidade, clima, solo e outros fatores', tags: ['ecossistemas', 'biodiversidade', 'biomas', 'Brasil', 'floresta'] },
          { code: 'EF08CI04', desc: 'Demonstrar que o ar é uma mistura de gases e discutir fenômenos naturais e antrópicos relacionados', tags: ['ar', 'gases', 'atmosfera', 'química', 'poluição'] },
          { code: 'EF08CI09', desc: 'Relacionar a estrutura e dinâmica da Terra (vulcanismo, abalos sísmicos, deriva) ao modelo das placas tectônicas', tags: ['placas tectônicas', 'vulcanismo', 'terremoto', 'geologia', 'Terra'] },
          { code: 'EF09CI01', desc: 'Investigar as mudanças de estado físico da matéria e explicar essas transformações com base no modelo cinético molecular', tags: ['estados físicos', 'fusão', 'evaporação', 'matéria', 'partículas'] },
          { code: 'EF09CI06', desc: 'Selecionar argumentos sobre a viabilidade da sobrevivência humana fora da Terra com base em dados sobre o Sistema Solar', tags: ['sistema solar', 'astronomia', 'espaço', 'planetas', 'universo'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CNT101', desc: 'Analisar e representar as transformações e conservações em sistemas que envolvam quantidade de matéria, energia', tags: ['energia', 'matéria', 'transformação', 'conservação', 'termodinâmica'] },
          { code: 'EM13CNT201', desc: 'Analisar e utilizar modelos científicos para elaborar explicações sobre fenômenos naturais', tags: ['modelo científico', 'fenômeno', 'experimentação', 'investigação'] },
          { code: 'EM13CNT301', desc: 'Construir e utilizar tabelas, gráficos e esquemas para analisar dados, identificar regularidades e inconsistências', tags: ['gráficos', 'dados', 'tabelas', 'análise', 'estatística'] },
        ],
      },
    ],
  },

  // ─── HISTÓRIA ─────────────────────────────────────────────────────────────
  {
    names: ['história', 'historia', 'hi'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01HI01', desc: 'Identificar aspectos do seu crescimento por meio do registro das lembranças particulares ou de sua comunidade', tags: ['memória', 'identidade', 'família', 'história pessoal', 'infância'] },
          { code: 'EF02HI01', desc: 'Reconhecer espaços de memória (museus, arquivos, monumentos) e identificar seus usos sociais', tags: ['memória', 'patrimônio', 'museu', 'identidade', 'monumento'] },
          { code: 'EF03HI01', desc: 'Identificar grupos populacionais que formam a comunidade, o município e a região e os eventos que marcam a formação da cidade', tags: ['comunidade', 'município', 'grupos sociais', 'cidade', 'formação'] },
          { code: 'EF04HI01', desc: 'Reconhecer a noção de "documento" e identificar os tipos de documentos históricos', tags: ['documento', 'fonte histórica', 'história', 'evidência', 'pesquisa'] },
          { code: 'EF05HI01', desc: 'Identificar os processos de formação das culturas e dos povos, relacionando-os com o espaço geográfico ocupado', tags: ['cultura', 'povos', 'formação', 'espaço', 'diversidade'] },
          { code: 'EF05HI04', desc: 'Associar a noção de cidadania com os princípios de respeito à diversidade, à pluralidade e aos direitos humanos', tags: ['cidadania', 'diversidade', 'direitos humanos', 'respeito', 'democracia'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06HI01', desc: 'Identificar diferentes formas de compreensão da noção de tempo e de periodização dos processos históricos (continuidades e rupturas)', tags: ['tempo histórico', 'periodização', 'continuidade', 'ruptura', 'cronologia'] },
          { code: 'EF06HI02', desc: 'Identificar a gênese da produção do saber histórico e analisar o significado das fontes que originaram determinadas formas de registro', tags: ['fonte histórica', 'historiografia', 'método histórico', 'documento', 'saber'] },
          { code: 'EF07HI01', desc: 'Explicar o significado de "modernidade" e suas lógicas de inclusão e exclusão, com base em uma concepção europeia', tags: ['modernidade', 'inclusão', 'exclusão', 'renascimento', 'europa'] },
          { code: 'EF07HI02', desc: 'Identificar conexões e interações entre as sociedades do Novo Mundo, África, Europa e Ásia no período das Grandes Navegações', tags: ['grandes navegações', 'expansão marítima', 'colonização', 'globalização', 'comércio'] },
          { code: 'EF08HI01', desc: 'Identificar os mecanismos e as dinâmicas de manutenção ou de alteração das estruturas sociais nas sociedades do século XIX', tags: ['século XIX', 'industrialização', 'revolução industrial', 'classes sociais', 'capitalismo'] },
          { code: 'EF08HI06', desc: 'Identificar e contextualizar o protagonismo dos movimentos sociais e a luta por direitos no Brasil', tags: ['movimentos sociais', 'abolição', 'república', 'direitos', 'escravidão'] },
          { code: 'EF09HI01', desc: 'Descrever e contextualizar os principais aspectos políticos, econômicos e sociais da emergência da República no Brasil', tags: ['república', 'Brasil', 'proclamação', 'política', 'federalismo'] },
          { code: 'EF09HI04', desc: 'Discutir as causas e os impactos das duas Guerras Mundiais na ordem política, econômica e social', tags: ['primeira guerra', 'segunda guerra', 'nazismo', 'fascismo', 'conflito mundial'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CHS101', desc: 'Analisar e comparar diferentes fontes e narrativas expressas em diversas linguagens sobre o mesmo fenômeno histórico', tags: ['fonte histórica', 'narrativa', 'análise crítica', 'interpretação', 'historiografia'] },
          { code: 'EM13CHS201', desc: 'Analisar e caracterizar as dinâmicas das populações, das mercadorias e do capital nos processos de industrialização', tags: ['industrialização', 'capitalismo', 'globalização', 'população', 'comércio'] },
          { code: 'EM13CHS301', desc: 'Identificar e analisar as demandas e os protagonismos políticos, sociais e culturais dos povos indígenas e povos e comunidades tradicionais', tags: ['povos indígenas', 'comunidades tradicionais', 'direitos', 'protagonismo', 'cultura'] },
        ],
      },
    ],
  },

  // ─── GEOGRAFIA ───────────────────────────────────────────────────────────
  {
    names: ['geografia', 'geo', 'ge'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01GE01', desc: 'Descrever características dos lugares de vivência (moradia, escola) e identificar semelhanças e diferenças entre esses lugares', tags: ['lugar', 'espaço', 'vivência', 'bairro', 'escola', 'moradia'] },
          { code: 'EF02GE01', desc: 'Comparar unidades de tempo da vida cotidiana dos alunos com as de colegas de outras épocas e lugares', tags: ['tempo', 'cotidiano', 'comparação', 'lugar', 'história'] },
          { code: 'EF03GE01', desc: 'Identificar e comparar aspectos culturais dos grupos sociais nos lugares de vivência', tags: ['cultura', 'grupos sociais', 'identidade', 'comunidade', 'diversidade'] },
          { code: 'EF04GE04', desc: 'Reconhecer as características da cidade e do campo, identificando usos do solo, formas de vida e trabalho', tags: ['campo', 'cidade', 'rural', 'urbano', 'trabalho'] },
          { code: 'EF05GE01', desc: 'Descrever e analisar dinâmicas populacionais na Unidade da Federação em que vive', tags: ['população', 'migração', 'demografia', 'estado', 'Brasil'] },
          { code: 'EF05GE11', desc: 'Reconhecer e comparar unidades de tempo, medidas de comprimento e sistemas de orientação (pontos cardeais, rosa dos ventos)', tags: ['orientação', 'pontos cardeais', 'rosa dos ventos', 'mapa', 'cartografia'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06GE01', desc: 'Comparar modificações das paisagens nos lugares de vivência e os usos desses lugares em diferentes tempos', tags: ['paisagem', 'modificação', 'espaço', 'tempo', 'urbanização'] },
          { code: 'EF06GE02', desc: 'Analisar modificações de paisagens por diferentes tipos de sociedade, destacando povos originários', tags: ['paisagem', 'sociedade', 'transformação', 'meio ambiente', 'indígenas'] },
          { code: 'EF07GE01', desc: 'Avaliar, por meio de exemplos locais e regionais, a importância do trabalho na produção da cultura e da vida social', tags: ['trabalho', 'cultura', 'produção', 'economia', 'local'] },
          { code: 'EF07GE09', desc: 'Interpretar e elaborar mapas temáticos e históricos, inclusive usando tecnologias digitais', tags: ['mapa', 'cartografia', 'tecnologia digital', 'análise espacial', 'geoprocessamento'] },
          { code: 'EF08GE01', desc: 'Estabelecer relações entre os processos de industrialização e inovação tecnológica com as transformações socioespaciais', tags: ['industrialização', 'indústria', 'urbanização', 'tecnologia', 'espaço'] },
          { code: 'EF09GE01', desc: 'Analisar características de países e grupos de países em termos de indicadores de desenvolvimento humano (IDH)', tags: ['desenvolvimento', 'IDH', 'globalização', 'países', 'desigualdade'] },
          { code: 'EF09GE03', desc: 'Identificar os significados histórico-geográficos das regiões de fronteiras e as redes e fluxos populacionais', tags: ['fronteiras', 'migração', 'fluxos', 'fronteira', 'geopolítica'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CHS103', desc: 'Elaborar hipóteses, selecionar evidências e compor argumentos para analisar fenômenos histórico-geográficos contemporâneos', tags: ['análise', 'argumentação', 'contemporâneo', 'evidência', 'hipótese'] },
          { code: 'EM13CHS204', desc: 'Comparar as características dos processos de industrialização no espaço mundial com os do Brasil', tags: ['industrialização', 'espaço mundial', 'Brasil', 'comparação', 'geopolítica'] },
          { code: 'EM13CHS403', desc: 'Analisar as múltiplas escalas (local, regional, nacional e global) em que se manifesta os fenômenos geográficos', tags: ['escala', 'local', 'global', 'regional', 'análise espacial'] },
        ],
      },
    ],
  },

  // ─── ARTE ─────────────────────────────────────────────────────────────────
  {
    names: ['arte', 'artes', 'educação artística', 'educacao artistica', 'ar'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01AR01', desc: 'Identificar e apreciar formas distintas das artes visuais tradicionais e contemporâneas', tags: ['artes visuais', 'apreciação', 'visual', 'contemporâneo', 'tradição'] },
          { code: 'EF02AR03', desc: 'Identificar e apreciar criticamente diversas formas e gêneros de expressão musical', tags: ['música', 'gêneros musicais', 'apreciação', 'expressão', 'som'] },
          { code: 'EF04AR10', desc: 'Identificar e descrever os elementos constitutivos da dança (espaço, tempo, força e fluxo)', tags: ['dança', 'espaço', 'tempo', 'movimento', 'expressão corporal'] },
          { code: 'EF05AR23', desc: 'Reconhecer e analisar as relações entre as artes visuais e os contextos sociais, culturais e históricos', tags: ['contexto histórico', 'artes visuais', 'cultura', 'social', 'arte brasileira'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF69AR01', desc: 'Pesquisar, apreciar e analisar formas distintas das artes visuais tradicionais e contemporâneas', tags: ['artes visuais', 'pesquisa', 'contemporâneo', 'apreciação', 'crítica'] },
          { code: 'EF69AR07', desc: 'Identificar e analisar diferentes estilos musicais, valorizando e respeitando a diversidade cultural', tags: ['estilos musicais', 'diversidade', 'cultura', 'música brasileira', 'análise'] },
          { code: 'EF69AR16', desc: 'Analisar criticamente aspectos históricos, políticos e sociais da produção artística', tags: ['história da arte', 'análise crítica', 'política', 'social', 'arte'] },
          { code: 'EF69AR25', desc: 'Reconhecer e analisar a influência de distintas matrizes estéticas e culturais das artes visuais nas produções artísticas', tags: ['matrizes culturais', 'estética', 'influência', 'arte africana', 'arte indígena'] },
        ],
      },
    ],
  },

  // ─── EDUCAÇÃO FÍSICA ──────────────────────────────────────────────────────
  {
    names: ['educação física', 'educacao fisica', 'ed física', 'ed fisica', 'ef'],
    blocks: [
      {
        label: 'EF Anos Iniciais (1º–5º ano)',
        gradeKeys: ['1', '2', '3', '4', '5', 'iniciais', 'fundamental i'],
        skills: [
          { code: 'EF01EF01', desc: 'Experimentar, fruir e recriar diferentes brincadeiras e jogos da cultura popular, valorizando a cultura local', tags: ['brincadeiras', 'jogos', 'cultura popular', 'lúdico', 'infância'] },
          { code: 'EF02EF07', desc: 'Experimentar e fruir diferentes modalidades da ginástica geral, propondo variações', tags: ['ginástica', 'movimento', 'corpo', 'coordenação', 'expressão corporal'] },
          { code: 'EF04EF11', desc: 'Experimentar e fruir diferentes práticas corporais de aventura na natureza, valorizando a conservação da natureza', tags: ['aventura', 'natureza', 'esportes', 'outdoor', 'sustentabilidade'] },
        ],
      },
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06EF01', desc: 'Experimentar e fruir as modalidades esportivas individuais e coletivas, valorizando o trabalho coletivo', tags: ['esporte', 'coletivo', 'individual', 'competição', 'cooperação'] },
          { code: 'EF07EF08', desc: 'Identificar situações de injustiça e preconceito nos esportes e demais práticas corporais, propondo alternativas para superar isso', tags: ['preconceito', 'injustiça', 'inclusão', 'fairplay', 'esporte'] },
          { code: 'EF09EF14', desc: 'Identificar e discutir os riscos para a saúde e à integridade física relacionados ao uso de determinadas substâncias', tags: ['saúde', 'drogas', 'doping', 'integridade', 'bem-estar'] },
        ],
      },
    ],
  },

  // ─── FÍSICA ──────────────────────────────────────────────────────────────
  {
    names: ['física', 'fisica', 'fis'],
    blocks: [
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CNT101', desc: 'Analisar e representar transformações e conservações de energia, quantidade de matéria e movimento para prever efeitos técnicos, sociais e ambientais', tags: ['energia', 'conservação', 'transformação', 'mecânica', 'termodinâmica'] },
          { code: 'EM13CNT102', desc: 'Realizar previsões e planejar experimentos com base em análise crítica de fontes diversas: experimentos, simulações e modelos', tags: ['experimento', 'previsão', 'modelo', 'laboratório', 'método científico'] },
          { code: 'EM13CNT103', desc: 'Utilizar o conhecimento sobre radiações e suas origens para avaliar potencialidades e riscos em equipamentos cotidianos e medicina', tags: ['radiação', 'ondas eletromagnéticas', 'óptica', 'física moderna', 'radioatividade'] },
          { code: 'EM13CNT204', desc: 'Elaborar previsões e cálculos sobre movimentos de objetos no espaço, incluindo o Sistema Solar, com base em interações gravitacionais', tags: ['cinemática', 'dinâmica', 'gravitação', 'movimentos', 'astrofísica'] },
          { code: 'EM13CNT301', desc: 'Construir questões, elaborar hipóteses e empregar instrumentos de medição para construir e justificar conclusões experimentais', tags: ['hipótese', 'medição', 'experimento', 'grandezas físicas', 'laboratório'] },
          { code: 'EM13CNT303', desc: 'Interpretar textos de divulgação científica sobre Ciências da Natureza, avaliando dados, evidências e possíveis interesses envolvidos', tags: ['eletromagnetismo', 'física quântica', 'divulgação científica', 'análise'] },
        ],
      },
    ],
  },

  // ─── QUÍMICA ─────────────────────────────────────────────────────────────
  {
    names: ['química', 'quimica', 'qui'],
    blocks: [
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CNT101', desc: 'Analisar transformações e conservações de quantidade de matéria e energia em reações químicas, avaliando efeitos sociais e ambientais', tags: ['reação química', 'transformação da matéria', 'equações', 'estequiometria', 'energia'] },
          { code: 'EM13CNT104', desc: 'Avaliar benefícios e riscos à saúde e ao ambiente do uso de agrotóxicos e outros recursos tecnológicos na produção de alimentos', tags: ['agrotóxico', 'química orgânica', 'alimentos', 'saúde', 'sustentabilidade'] },
          { code: 'EM13CNT105', desc: 'Analisar os ciclos biogeoquímicos e interpretar efeitos da interferência humana sobre esses ciclos para promover ações sustentáveis', tags: ['ciclos biogeoquímicos', 'carbono', 'nitrogênio', 'química ambiental', 'poluição'] },
          { code: 'EM13CNT202', desc: 'Comunicar resultados de análises e experimentos, elaborando e interpretando gráficos, tabelas, equações e sistemas de classificação', tags: ['tabela periódica', 'nomenclatura', 'classificação', 'gráficos', 'comunicação científica'] },
          { code: 'EM13CNT301', desc: 'Elaborar hipóteses, empregar instrumentos de medição e interpretar modelos explicativos para resolver situações-problema', tags: ['laboratório', 'hipótese', 'experimento', 'segurança química', 'propriedades'] },
          { code: 'EM13CNT304', desc: 'Analisar situações controversas sobre a aplicação de conhecimentos químicos como agrotóxicos, manipulação e exploração de recursos', tags: ['química orgânica', 'polímeros', 'petroquímica', 'ética', 'controvérsia'] },
        ],
      },
    ],
  },

  // ─── BIOLOGIA ────────────────────────────────────────────────────────────
  {
    names: ['biologia', 'bio'],
    blocks: [
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CNT105', desc: 'Analisar os ciclos biogeoquímicos e interpretar efeitos da interferência humana sobre esses ciclos para promover ações sustentáveis', tags: ['ecologia', 'ciclos da natureza', 'cadeia alimentar', 'biomas', 'sustentabilidade'] },
          { code: 'EM13CNT106', desc: 'Avaliar a viabilidade de intervenções humanas no ambiente, considerando benefícios e riscos para populações e demais seres vivos', tags: ['genética', 'biotecnologia', 'OGM', 'biodiversidade', 'impacto ambiental'] },
          { code: 'EM13CNT203', desc: 'Avaliar e prever efeitos de intervenções nos ecossistemas e nos organismos, tendo em vista a conservação ambiental e qualidade de vida', tags: ['ecossistema', 'saúde', 'organismos', 'evolução', 'adaptação'] },
          { code: 'EM13CNT206', desc: 'Discutir a importância da preservação das culturas indígenas e comunidades tradicionais e sua relação com a conservação da sociobiodiversidade', tags: ['biodiversidade', 'etnobiologia', 'preservação', 'povos indígenas', 'botânica'] },
          { code: 'EM13CNT207', desc: 'Identificar vulnerabilidades contemporâneas das juventudes nos aspectos físico, psicoemocional e social, desenvolvendo ações de saúde coletiva', tags: ['saúde', 'corpo humano', 'sistema imune', 'doenças', 'bem-estar'] },
          { code: 'EM13CNT305', desc: 'Investigar o uso indevido de conhecimentos das Ciências Naturais em justificativas de discriminação para promover respeito à diversidade', tags: ['genética humana', 'evolução', 'racismo científico', 'diversidade', 'ética'] },
        ],
      },
    ],
  },

  // ─── SOCIOLOGIA ──────────────────────────────────────────────────────────
  {
    names: ['sociologia', 'socio'],
    blocks: [
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CHS102', desc: 'Identificar e analisar matrizes conceituais como etnocentrismo, racismo, modernidade e coletivismo, explicitando seu papel na transformação das sociedades', tags: ['cultura', 'etnocentrismo', 'modernidade', 'capitalismo', 'ideologia'] },
          { code: 'EM13CHS201', desc: 'Analisar as dinâmicas das populações e do capital nos processos de industrialização e urbanização, identificando contradições e formas de resistência', tags: ['industrialização', 'classes sociais', 'urbanização', 'desigualdade', 'trabalho'] },
          { code: 'EM13CHS203', desc: 'Comparar os significados de cidadania e democracia em diferentes contextos históricos, identificando possibilidades de exercício no contexto atual', tags: ['cidadania', 'democracia', 'política', 'direitos', 'participação'] },
          { code: 'EM13CHS401', desc: 'Identificar e analisar as relações entre sujeitos, grupos, classes e sociedades que integram a dinâmica social, incluindo discussões sobre desigualdades', tags: ['classes sociais', 'movimentos sociais', 'desigualdade', 'grupos sociais', 'conflito'] },
          { code: 'EM13CHS404', desc: 'Analisar as formas de exercício dos direitos humanos, refletindo sobre mecanismos de garantia e proteção', tags: ['direitos humanos', 'cidadania', 'democracia', 'legislação', 'proteção social'] },
          { code: 'EM13CHS604', desc: 'Analisar os impactos das transformações tecnológicas nas relações de produção e de trabalho, nas estruturas familiares e nas formas de sociabilidade', tags: ['tecnologia', 'trabalho', 'família', 'sociabilidade', 'redes sociais'] },
        ],
      },
    ],
  },

  // ─── FILOSOFIA ───────────────────────────────────────────────────────────
  {
    names: ['filosofia', 'filo'],
    blocks: [
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13CHS101', desc: 'Analisar e comparar diferentes fontes e narrativas para a compreensão de ideias filosóficas e processos históricos, políticos e culturais', tags: ['filosofia', 'epistemologia', 'pensamento crítico', 'análise', 'narrativa'] },
          { code: 'EM13CHS103', desc: 'Elaborar hipóteses, selecionar evidências e compor argumentos relativos a processos culturais e epistemológicos com base em textos filosóficos', tags: ['argumentação', 'lógica', 'epistemologia', 'texto filosófico', 'raciocínio'] },
          { code: 'EM13CHS104', desc: 'Analisar objetos da cultura material e imaterial como suporte de conhecimentos, valores, crenças e práticas de diferentes sociedades', tags: ['cultura', 'valores', 'ética', 'estética', 'ontologia'] },
          { code: 'EM13CHS501', desc: 'Analisar os fundamentos da ética em diferentes tradições filosóficas e culturais, com vistas ao desenvolvimento da autonomia intelectual e pensamento crítico', tags: ['ética', 'moral', 'filosofia moral', 'autonomia', 'virtude'] },
          { code: 'EM13CHS502', desc: 'Analisar situações da vida cotidiana que envolvam discriminação ou violação de direitos, promovendo uma cultura de paz', tags: ['ética aplicada', 'direitos humanos', 'justiça', 'política', 'cidadania'] },
          { code: 'EM13CHS105', desc: 'Identificar, contextualizar e criticar tipologias evolutivas e qualquer forma de discriminação das sociedades humanas e de seus saberes e valores', tags: ['filosofia política', 'crítica', 'discriminação', 'diversidade', 'alteridade'] },
        ],
      },
    ],
  },

  // ─── LÍNGUA INGLESA ──────────────────────────────────────────────────────
  {
    names: ['inglês', 'ingles', 'língua inglesa', 'lingua inglesa', 'english', 'li'],
    blocks: [
      {
        label: 'EF Anos Finais (6º–9º ano)',
        gradeKeys: ['6', '7', '8', '9', 'sexto', 'sétimo', 'oitavo', 'nono', 'finais', 'fundamental ii'],
        skills: [
          { code: 'EF06LI01', desc: 'Identificar o idioma inglês e sua presença no cotidiano (marcas, produtos, músicas, mídias)', tags: ['inglês', 'cotidiano', 'mídia', 'língua', 'cultura'] },
          { code: 'EF07LI04', desc: 'Ler e compreender textos de gêneros variados, identificando a ideia principal e informações relevantes', tags: ['leitura', 'compreensão', 'gêneros textuais', 'texto', 'informação'] },
          { code: 'EF08LI08', desc: 'Produzir textos escritos em língua inglesa, adequando a linguagem ao gênero e ao propósito comunicativo', tags: ['produção textual', 'escrita', 'gênero', 'comunicação', 'inglês'] },
          { code: 'EF09LI02', desc: 'Compreender a língua inglesa como fenômeno variável e plural, reconhecendo variedades do inglês no mundo', tags: ['variação linguística', 'diversidade', 'world englishes', 'cultura', 'global'] },
        ],
      },
      {
        label: 'Ensino Médio',
        gradeKeys: ['médio', 'medio', 'em', '1ª série', '2ª série', '3ª série', 'ensino médio'],
        skills: [
          { code: 'EM13LGG301', desc: 'Utilizar diferentes linguagens (artísticas, corporais e verbais) para exercer protagonismo e autoria', tags: ['protagonismo', 'autoria', 'linguagem', 'expressão', 'comunicação'] },
          { code: 'EM13LGG401', desc: 'Compreender as línguas como fenômeno (geo)político, histórico, social, variável, heterogêneo e sensível ao contexto', tags: ['sociolinguística', 'variação', 'contexto', 'política linguística', 'inglês'] },
        ],
      },
    ],
  },
];

// ── Funções auxiliares ────────────────────────────────────────────────────────

/** Detecta o grupo de série a partir do nome da turma. */
const detectGradeKey = (className: string): string => {
  const s = className.toLowerCase();
  if (/ensino médio|médio|1ª série|2ª série|3ª série|\bem\b/.test(s)) return 'médio';
  const match = s.match(/([1-9])[°º\s]*ano/);
  return match ? match[1] : '';
};

/** Normaliza string para comparação. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Quão bem o nome digitado pela disciplina casa com um dos nomes conhecidos.
 * 3 = igual · 2 = nome composto contido · 1 = apelido como palavra inteira · 0 = não casa
 *
 * O casamento por palavra inteira é essencial: com `includes` cru, o apelido
 * "ci" de Ciências casava dentro de "soCIologia" e o professor de Sociologia
 * recebia habilidades de Ciências da Natureza no plano de aula. Pelo mesmo
 * motivo "bio" casava dentro de "astrobiologia".
 */
const subjectMatchScore = (normSubject: string, names: string[]): number => {
  const words = normSubject.split(/\s+/).filter(Boolean);
  let best = 0;
  for (const name of names) {
    const n = norm(name);
    if (n === normSubject) return 3;
    if (n.includes(' ') && normSubject.includes(n)) best = Math.max(best, 2);
    else if (words.includes(n)) best = Math.max(best, 1);
  }
  return best;
};

/**
 * Seleciona as habilidades BNCC mais relevantes para a combinação
 * disciplina + turma + tópico da aula.
 *
 * @param subject  Nome da disciplina (vem do profile.subject)
 * @param className  Nome da turma (ex: "8º ano A")
 * @param topic  Tópico da aula (ex: "Revolução Industrial")
 * @param count  Quantidade máxima de habilidades a retornar (padrão: 4)
 */
export const selectBnccSkills = (
  subject: string,
  className: string,
  topic: string,
  count = 4,
): BnccSkill[] => {
  const normSubject = norm(subject);
  const gradeKey    = detectGradeKey(className);
  const normTopic   = norm(topic);
  const topicWords  = normTopic.split(/\s+/).filter(w => w.length > 3);

  // 1. Encontrar a disciplina — vence o casamento mais específico, para que
  //    "Educação Física" não caia em Física por conta da segunda palavra.
  let found: BnccSubject | undefined;
  let bestScore = 0;
  for (const candidate of bnccData) {
    const score = subjectMatchScore(normSubject, candidate.names);
    if (score > bestScore) { bestScore = score; found = candidate; }
  }
  if (!found) return [];

  // 2. Encontrar o bloco de série mais próximo
  let block = found.blocks.find(b => b.gradeKeys.some(k => gradeKey.includes(k) || k.includes(gradeKey)));
  if (!block) block = found.blocks[0]; // fallback: primeiro bloco

  // 3. Pontuar por relevância temática e selecionar
  const scored = block.skills.map(skill => {
    const normTags = skill.tags.map(norm);
    const normDesc = norm(skill.desc);
    let score = 0;
    topicWords.forEach(word => {
      if (normTags.some(t => t.includes(word) || word.includes(t))) score += 2;
      if (normDesc.includes(word)) score += 1;
    });
    return { skill, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(s => s.skill);
};

export const SUBJECT_OPTIONS = [
  'Língua Portuguesa',
  'Matemática',
  'Ciências',
  'História',
  'Geografia',
  'Arte',
  'Educação Física',
  'Física',
  'Química',
  'Biologia',
  'Sociologia',
  'Filosofia',
  'Língua Inglesa',
  'Outra',
];

// ── Validação determinística das habilidades no plano gerado ─────────────────
// A IA inventa códigos de habilidade que não existem. Em vez de pedir a ela que
// confira o próprio trabalho, conferimos aqui: extraímos os códigos do texto e
// comparamos com as habilidades reais que foram injetadas no comando. Se houver
// código inventado, faltando, ou nenhum código, a seção é reescrita.

// Padrão como string: a expressão global é construída a cada uso para não
// carregar `lastIndex` entre chamadas.
const BNCC_CODE_SOURCE = '\\b(EF\\d{2}[A-Z]{2}\\d{2}|EM13[A-Z]{3}\\d{3})\\b';

/** Todos os códigos BNCC presentes no texto, em maiúsculas e sem repetição. */
export const extractBnccCodes = (text: string): string[] => {
  const found = text.match(new RegExp(BNCC_CODE_SOURCE, 'g')) || [];
  return [...new Set(found.map(c => c.toUpperCase()))];
};

/** Bloco em Markdown com as habilidades verificadas, uma por linha. */
export const formatBnccBlock = (skills: BnccSkill[]): string =>
  skills.map(s => `- ${s.code} — ${s.desc}`).join('\n');

export type BnccValidationReason =
  | 'ok'              // o plano já está correto
  | 'codigo-invalido' // a IA citou código que não existe no banco
  | 'codigo-faltante' // faltou citar alguma habilidade injetada
  | 'sem-codigo'      // o plano não trouxe nenhum código
  | 'secao-ausente';  // a IA nem gerou a seção de habilidades

export interface BnccValidationResult {
  /** Plano corrigido (ou o original, se nada precisou mudar). */
  text: string;
  corrected: boolean;
  reason: BnccValidationReason;
  invalidCodes: string[];
  missingCodes: string[];
}

const BNCC_SECTION_TITLE = '## HABILIDADE (BNCC)';
const BNCC_SECTION_PATTERN = /## Habilidade \(BNCC\)[\s\S]*?(?=\n## |\n---|\n#[^#]|$)/i;

/**
 * Confere as habilidades BNCC de um plano gerado contra as habilidades reais
 * que foram entregues à IA, e reescreve a seção quando necessário.
 *
 * Quando a seção não existe no plano, ela é acrescentada ao final — antes esse
 * caso passava batido e o plano saía sem nenhuma habilidade.
 */
export const validateBnccSection = (planText: string, skills: BnccSkill[]): BnccValidationResult => {
  const unchanged: BnccValidationResult = {
    text: planText, corrected: false, reason: 'ok', invalidCodes: [], missingCodes: [],
  };
  // Sem habilidades injetadas (educação infantil, disciplina fora do banco) não
  // há contra o que comparar — devolve o plano como veio.
  if (skills.length === 0) return unchanged;

  const validCodes = new Set(skills.map(s => s.code.toUpperCase()));
  const codesInPlan = extractBnccCodes(planText);

  const invalidCodes = codesInPlan.filter(c => !validCodes.has(c));
  const missingCodes = skills.map(s => s.code.toUpperCase()).filter(c => !codesInPlan.includes(c));

  const hasSection = BNCC_SECTION_PATTERN.test(planText);

  if (invalidCodes.length === 0 && missingCodes.length === 0 && hasSection) return unchanged;

  const correctSection = `${BNCC_SECTION_TITLE}\n${formatBnccBlock(skills)}`;

  const reason: BnccValidationReason =
    !hasSection            ? 'secao-ausente'
    : invalidCodes.length  ? 'codigo-invalido'
    : missingCodes.length  ? 'codigo-faltante'
    : 'sem-codigo';

  const text = hasSection
    ? planText.replace(BNCC_SECTION_PATTERN, correctSection + '\n')
    : `${planText.replace(/\s+$/, '')}\n\n${correctSection}\n`;

  return { text, corrected: true, reason, invalidCodes, missingCodes };
};
