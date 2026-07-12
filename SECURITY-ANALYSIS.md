# Análise de Segurança — Prof. Corujão

**Data:** 2026-07-12 · **Escopo:** código do app (React/Vite), regras do Firestore/Storage, Cloud Functions, dependências e configuração de deploy.

> Veja também a seção **[Conformidade com a LGPD](#conformidade-com-a-lgpd)** ao final.

---

## Resumo executivo

O ponto mais grave é que a **chave da API do Gemini é embutida no bundle JavaScript público** e todas as chamadas de IA saem direto do navegador. Qualquer pessoa pode extrair a chave e consumir a cota/fatura do projeto, e o limite de 10 gerações do plano free é aplicado somente no cliente — ou seja, é contornável. A correção estrutural para ambos é a mesma: mover as chamadas de IA para um backend.

Fora isso, o projeto tem práticas boas e visíveis: regras do Firestore bem pensadas (proteção de `role`, `uid` e campos de billing), uso de `DOMPurify` e `escapeHtml` nos caminhos de HTML dinâmico, `.env*` fora do git e validação de tamanho/tipo no upload de fotos.

| # | Severidade | Achado | Status |
|---|-----------|--------|--------|
| 1 | 🔴 Crítica | `GEMINI_API_KEY` exposta no bundle do cliente | ✅ Corrigido |
| 2 | 🔴 Alta | Limite de gerações free aplicado apenas no cliente | ✅ Corrigido |
| 3 | 🟠 Alta | Reset da cota free via delete + recreate do próprio documento de usuário | ✅ Corrigido |
| 4 | 🟠 Alta | Dependências com vulnerabilidades conhecidas (1 crítica, 3 altas) | ✅ Corrigido (2 resíduos aceitos) |
| 5 | 🟡 Média | `PIXABAY_API_KEY` também exposta no bundle | ✅ Corrigido |
| 6 | 🟡 Média | Ausência de headers de segurança (CSP etc.) no deploy | ✅ Corrigido (CSP em Report-Only) |
| 7 | 🟡 Média | Escrita em `config/stats` pelo cliente é negada pelas regras (bug funcional) | ✅ Corrigido |
| 8 | 🔵 Baixa | E-mail do admin hardcoded nas regras e no bundle público | ✅ Mitigado (suporte a custom claim) |
| 9 | 🔵 Baixa | Assets críticos hospedados em terceiros (i.ibb.co) sem controle | ⚠️ Pendente (passo manual) |

---

## Correções aplicadas (2026-07-12)

Todos os itens foram tratados nos commits desta branch. Resumo do que mudou:

- **#1 / #2 / #7 — Proxy de IA no backend.** Nova Cloud Function `generateAi`
  (`functions/index.js`) guarda a `GEMINI_API_KEY` como *secret* do servidor,
  exige Firebase Auth, retenta 503/429 no servidor e contabiliza tokens +
  estatísticas globais via Admin SDK (o que também conserta o `config/stats` do
  #7). O cliente (`src/App.tsx`) agora chama essa function em vez de instanciar o
  Gemini no navegador; o `define` da chave saiu do `vite.config.ts`.
  ⚠️ **Rotacione a `GEMINI_API_KEY`** — ela esteve em builds públicos.
- **#2 / #3 — Cota inviolável.** O contador da fonte da verdade vive em
  `usage/{uid}`, coleção que as regras (`firestore.rules`) tornam **somente‑leitura
  para o cliente** (escrita apenas pelo backend). Isso elimina o bypass de
  delete+recreate. As gerações "billable" (plano, slides, atividades/prova)
  passam `billable: true`; o backend valida o limite e incrementa atomicamente.
- **#4 — Dependências.** `npm audit fix` na raiz e em `functions/`. Restaram
  dois resíduos aceitos por exigirem *major* com breaking change: `esbuild`
  (baixa, só afeta o dev‑server no Windows) e `uuid` transitivo do
  `firebase-admin` (moderada; correção pede `firebase-admin@14`).
- **#5 — Pixabay no backend.** Nova function `pixabaySearch` faz a busca com a
  chave no servidor; a `PIXABAY_API_KEY` saiu do bundle. Os 3 pontos do cliente
  usam o helper `pixabaySearchHits`.
- **#6 — Headers.** `vercel.json` passa a enviar `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e HSTS. Agora
  também há uma **`Content-Security-Policy-Report-Only`** cobrindo Google Fonts,
  os endpoints do Firebase (Auth/Firestore/Functions/Storage/FCM), Pixabay e
  imagens externas. Está em `Report-Only` de propósito: não bloqueia nada, só
  reporta violações no console do navegador — assim dá para observar as janelas
  de impressão (`document.write`) e outros pontos antes de promover para
  `Content-Security-Policy` (bloqueante).
- **#8 — Admin por custom claim.** `firestore.rules` e `storage.rules` passam a
  aceitar `request.auth.token.admin == true` como sinal de admin (caminho
  preferido, atribuído pelo Admin SDK), mantendo e-mail/role como *fallback*
  legado. Recomendação: migrar o admin para custom claim e remover o e-mail fixo.
- **#9 — Assets de terceiros.** Requer baixar ~18 imagens do `i.ibb.co` e
  servi-las do próprio domínio (`public/`). A política de rede deste ambiente
  bloqueia o download desses hosts, então é um passo manual de operação (não foi
  automatizado aqui para não substituir imagens boas por quebradas).

> **Risco residual (documentado):** como o cliente decide o que é uma geração
> "billable", um atacante que monte requisições cruas à callable poderia marcar
> `billable: false` e burlar o paywall (não a chave, que está segura). A
> mitigação recomendada é habilitar **Firebase App Check** na function `generateAi`
> para bloquear clientes que não sejam o app oficial.

---

## 1. 🔴 CRÍTICA — Chave da API do Gemini embutida no bundle do cliente

**Onde:** `vite.config.ts:30` e `src/App.tsx:33-37`

```ts
// vite.config.ts
define: {
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
  ...
}

// src/App.tsx
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || 'fake-key-para-evitar-crash' });
```

O `define` do Vite substitui `process.env.GEMINI_API_KEY` pelo valor literal da chave **em tempo de build**. A chave fica em texto claro no JavaScript servido a qualquer visitante (nem precisa de login — o bundle é público). Qualquer pessoa pode:

- Extrair a chave com "view source" / DevTools e usá-la em seus próprios projetos;
- Consumir a cota do projeto e gerar custo direto na fatura do Google;
- Provocar `RESOURCE_EXHAUSTED` para todos os usuários legítimos (negação de serviço).

**Correção recomendada:** mover as chamadas de IA para um backend que guarda a chave em variável de ambiente do servidor:

- **Opção A (recomendada, já há infra):** Cloud Functions HTTPS `onCall` — valida o token do Firebase Auth, verifica `isPro`/`generationsUsed` no Firestore, chama o Gemini e **incrementa o contador na mesma transação**. Resolve também os achados #2 e #3.
- **Opção B:** Vercel Serverless Functions (`/api/generate`) validando o ID token do Firebase.
- Complementar com **Firebase App Check** para reduzir abuso automatizado.
- Após a migração, **revogar/rotacionar a chave atual** — ela já deve ser considerada vazada (esteve presente em todos os builds publicados).

> Nota: o `apiKey` de `firebase-applet-config.json` **não** é segredo (é identificador público do Firebase) — o problema é só a chave do Gemini. Ainda assim, vale aplicar restrições de referrer/API à chave do Firebase no console do Google Cloud.

## 2. 🔴 ALTA — Limite free aplicado apenas no cliente

**Onde:** `src/App.tsx:13807-13835` (`FREE_GENERATION_LIMIT`, `isLimitReached`, `recordGeneration`)

O gate de 10 gerações gratuitas é verificado no React (`isLimitReached`) e o incremento de `generationsUsed` é feito pelo próprio cliente (`recordGeneration`, "best-effort" com `catch` vazio). Como a chamada ao Gemini também parte do navegador (achado #1), um usuário free pode:

- Chamar a API diretamente com a chave extraída, sem passar pelo app; ou
- Modificar o cliente / bloquear a escrita no Firestore para nunca incrementar o contador.

As regras do Firestore impedem *diminuir* o contador (`billingFieldsProtected`), mas nada obriga a *incrementá-lo* — o servidor nunca participa da geração.

**Correção:** mesma do achado #1 — a verificação de cota e o incremento devem acontecer no backend, atomicamente, antes de chamar o Gemini.

## 3. 🟠 ALTA — Reset da cota via delete + recreate do documento de usuário

**Onde:** `firestore.rules:71-77`

```
allow create: if (isOwner(userId) && ... && noBillingPrivilegeCreated()) || ...
allow delete: if isOwner(userId) || ...
```

O dono pode **deletar o próprio documento** e recriá-lo — e `noBillingPrivilegeCreated()` exige exatamente `generationsUsed == 0` na criação. Sequência de bypass para um usuário free no limite:

1. `deleteDoc(users/{meuUid})` — permitido (`isOwner`);
2. `setDoc(users/{meuUid}, { ..., generationsUsed: 0 })` — permitido (create com contador zerado);
3. Cota resetada para 0/10, indefinidamente.

Não requer nenhuma ferramenta especial — só o SDK do Firebase já carregado na página. O paywall free é anulado.

**Correção:**

- A fonte da verdade da cota **não deve ser um campo editável pelo dono**. Ao mover o incremento para o backend (achado #1/#2), mantenha o contador num documento que o cliente **não** possa recriar — por exemplo `usage/{uid}` escrito apenas via Admin SDK (nenhuma regra de `create`/`write` para o cliente).
- Alternativamente, negar `delete` no documento de usuário e, caso a exclusão de conta seja necessária, tratá-la por uma função de backend que também apaga/arquiva o registro de uso.

## 4. 🟠 ALTA — Dependências com vulnerabilidades conhecidas

**Onde:** `package.json` / `package-lock.json` (`npm audit`)

`npm audit` reporta **12 vulnerabilidades (1 crítica, 3 altas, 6 moderadas, 2 baixas)**. Destaques que chegam ao runtime de produção (via `firebase`):

| Pacote | Severidade | Problema |
|---|---|---|
| `protobufjs` | Crítica | Execução de código / prototype pollution |
| `@grpc/grpc-js` | Alta | Crash de cliente/servidor por mensagem malformada |
| `ws` | Alta | Vazamento de memória / DoS |
| `dompurify` | Moderada | Múltiplos bypasses de XSS (afetam sobretudo o modo `IN_PLACE`, **não** usado aqui) |
| `vite`, `esbuild`, `postcss`, `body-parser`/`qs`, `@babel/core` | Moderada/Baixa | Diversos (majoritariamente ferramentas de build/dev) |

**Correção:**

- Rodar `npm audit fix` e revisar o diff. A maioria se resolve sem breaking change.
- Atualizar `firebase` para a versão mais recente (arrasta `protobufjs`/`@grpc/grpc-js` corrigidos) e **`dompurify`** para a última — é justamente o sanitizador usado na defesa de XSS (achado transversal).
- Integrar `npm audit` (ou Dependabot) na CI para não voltar a acumular.

## 5. 🟡 MÉDIA — `PIXABAY_API_KEY` também exposta no bundle

**Onde:** `vite.config.ts:31`, `src/App.tsx:435, 6410, 7499`

Mesmo mecanismo do achado #1: a chave do Pixabay é inlined no bundle e usada em URLs `https://pixabay.com/api/?key=...` a partir do navegador. O impacto é menor (chave gratuita), mas ela pode ser abusada por terceiros e o app já tem fallback quando ausente.

**Correção:** proxyar as buscas de imagem pelo mesmo backend dos itens #1/#2, ou aceitar o risco conscientemente (chave gratuita, sem custo direto) — mas manter a decisão documentada.

## 6. 🟡 MÉDIA — Ausência de headers de segurança no deploy

**Onde:** `vercel.json`

O deploy só define `rewrites` para a SPA; não há `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` nem `X-Frame-Options`. Dado o uso intenso de `document.write`/`innerHTML` com conteúdo gerado por IA (mitigado hoje por `escapeHtml`/`DOMPurify`, ver observação abaixo), uma CSP funciona como segunda linha de defesa contra XSS.

**Correção:** adicionar `headers` no `vercel.json`, por exemplo:

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
    ]
  }]
}
```

Uma `Content-Security-Policy` completa exige ajuste fino (fontes do Google, `i.ibb.co`, endpoints do Firebase/Gemini, e as janelas de impressão `about:blank`), então vale introduzi-la em modo `Report-Only` primeiro.

> **Observação (XSS — atualmente mitigado):** há muitos `w.document.write(...)` e manipulações de `innerHTML` nas rotinas de impressão (`src/App.tsx:6485, 7129, 8195, 10210, 10262, 10299` etc.). Hoje a defesa está correta: interpolações passam por `escapeHtml()` (`src/utils.ts:8`) e o HTML rico usa `DOMPurify.sanitize(parseRichHtml(...))` (`src/App.tsx:1435, 1458`). É um padrão frágil — qualquer trecho futuro que esqueça o escape vira XSS, ainda mais com conteúdo vindo de IA/entrada do usuário. Manter a disciplina e considerar centralizar a montagem desses documentos.

## 7. 🟡 MÉDIA — Escrita em `config/stats` pelo cliente é negada pelas regras

**Onde:** `src/App.tsx:13828-13833` vs `firestore.rules:55-58`

`recordGeneration` tenta `setDoc(doc(db, 'config', 'stats'), ...)` e `config/stats_{mes}`, mas as regras só permitem escrita em `config` para admin (`allow write: if isAdmin()`). Para usuários comuns a escrita **falha silenciosamente** (está dentro de `try/catch` vazio). Não é uma falha de segurança (as regras estão *corretas* ao negar), mas as estatísticas globais provavelmente **não estão sendo gravadas** para não-admins.

**Correção:** mover a agregação de estatísticas para o backend (mesma função dos achados #1/#2, via Admin SDK), que legitimamente ignora as regras. Assim as métricas passam a refletir todos os usuários.

## 8. 🔵 BAIXA — E-mail do admin hardcoded

**Onde:** `firestore.rules:11,20`, `storage.rules:16`, `src/utils.ts:29`

O admin "bootstrap" (`lyelsonmf520@gmail.com`) está fixo em vários arquivos. Funciona e depende de `email_verified`, mas é um ponto único de manutenção e expõe o e-mail do admin no bundle público (`utils.ts`). Se a conta for comprometida ou o e-mail precisar mudar, há edição em múltiplos lugares.

**Correção:** preferir uma custom claim (`admin: true`) atribuída via Admin SDK e checada nas regras (`request.auth.token.admin == true`), eliminando o e-mail literal. O e-mail no cliente é só cosmético (a autorização real é nas regras), mas convém removê-lo do bundle.

## 9. 🔵 BAIXA — Assets críticos em terceiros sem controle

**Onde:** `index.html` (ícones/OG), `src/sw.ts:17` (`NOTIF_ICON`), telas de login/fundo em `src/App.tsx`

Ícone do app, imagem de notificação e fundos são carregados de `https://i.ibb.co/...` (ImgBB). Se esse host cair, mudar o conteúdo ou expirar a imagem, a identidade visual/notificações quebram — e um terceiro passa a controlar bytes exibidos dentro do app.

**Correção:** hospedar esses assets no próprio projeto (`public/`) e servi-los pelo domínio do app / Firebase Storage.

---

## Boas práticas já presentes (não são achados)

- **Regras do Firestore bem construídas:** bloqueiam auto-promoção a `admin` (`noPrivilegedRoleCreated`, `roleNotModified`), impedem alterar `uid`, protegem `isPro`/`generationsUsed` contra rebaixamento, e evitam `get()` recursivo com `isAdminWithoutGet()`. A ressalva é o vetor delete+recreate (achado #3).
- **Storage:** upload de foto valida `size < 2MB` e `contentType` de imagem; escrita restrita ao dono; biblioteca só gravável pelo admin.
- **Sanitização:** `escapeHtml()` e `DOMPurify` nos caminhos de HTML dinâmico.
- **Segredos:** `.env*` no `.gitignore`; nenhuma chave secreta encontrada no histórico versionado (a `apiKey` do Firebase é pública por design).

## Prioridades recomendadas

1. **Tirar `GEMINI_API_KEY` do cliente** (backend proxy com validação de Auth + cota) e **rotacionar** a chave. Resolve #1, #2 e #7 de uma vez, e viabiliza a correção de #3.
2. **Corrigir o reset de cota** (#3): contador em documento não editável/recriável pelo dono.
3. `npm audit fix` + atualizar `firebase`/`dompurify` (#4).
4. Adicionar headers de segurança no `vercel.json` (#6) e avaliar #5, #8, #9.

---

## Conformidade com a LGPD

**Contexto:** o app trata dados pessoais do **professor** (nome, e-mail, foto, celular, escola, uso) e — inserido pelo professor — dados de **alunos**, muitos deles menores, incluindo **dados sensíveis de saúde** (TDAH/TEA/dislexia em pareceres e perfil da turma). O professor/escola é *controlador* desses dados; o app é *operador*. Parte do tratamento é feita pela IA do Google (Gemini), fora do Brasil.

### Achados e status

| # | Severidade | Achado LGPD | Status |
|---|-----------|-------------|--------|
| L1 | 🔴 Crítica | Dados de crianças/adolescentes sem consentimento/aviso (art. 14) | 🟡 Mitigado (consentimento + aviso de responsabilidade) |
| L2 | 🔴 Crítica/Alta | Dado sensível de saúde de menor enviado à IA no exterior (arts. 11, 33) | 🟡 Mitigado (avisos de minimização; decisão de base legal é do controlador) |
| L3 | 🟠 Alta | Ausência de Política de Privacidade e aviso de tratamento (arts. 6º, 9º) | ✅ Corrigido (rascunho no app) |
| L4 | 🟠 Alta | Sem consentimento/base legal registrada (arts. 7º, 8º) | ✅ Corrigido (aceite obrigatório + registro no doc) |
| L5 | 🟡 Média | Direito de eliminação incompleto (art. 18, VI) | ✅ Corrigido (foto + feedback + usage) |
| L6 | 🟡 Média | Foto legível por qualquer usuário autenticado | ✅ Corrigido (leitura só do dono/admin) |
| L7 | 🟡 Média | Sem portabilidade para o próprio titular (art. 18, V) | ✅ Corrigido (botão "Baixar meus dados") |
| L8 | 🟡 Média | Sem canal do titular / Encarregado (art. 41) | 🟡 Parcial (e-mail de contato na política — AJUSTAR) |
| L9 | 🔵 Baixa | Sem política de retenção documentada (arts. 15, 16) | ⚠️ Pendente (decisão do negócio) |

### O que foi implementado (código)

- **Política de Privacidade e Termos** (`PrivacyPolicyOverlay`): overlay acessível no login e no Perfil, cobrindo dados coletados, finalidade, IA/Google, transferência internacional, dados de menores (art. 14), direitos do titular e contato. **É um rascunho-base — revise com jurídico quando possível.**
- **Consentimento no cadastro**: checkbox obrigatório com link para a política; o cadastro é bloqueado sem aceite e o consentimento (versão + data) é gravado em `users/{uid}.consent`.
- **Exclusão de conta completa** (art. 18, VI): além das subcoleções, agora apaga a **foto no Storage**, os **feedbacks** do usuário e o contador `usage/{uid}` (via callable `deleteUserData`).
- **Minimização da foto**: `storage.rules` restringe a leitura ao próprio dono (e admin), em vez de qualquer usuário logado.
- **Portabilidade** (art. 18, V): botão **"Baixar meus dados"** no Perfil, que exporta um JSON com perfil + subcoleções.
- **Avisos de transparência** (`LgpdNotice`) nas telas que coletam dados de alunos (perfil da turma, parecer, diário), lembrando a responsabilidade do professor e o processamento por IA. O placeholder que sugeria dado sensível ("2 alunos com TDAH") foi removido.

### O que ainda depende de você (não é código)

- **Definir o e-mail/Encarregado** para o canal do titular: ajuste `PRIVACY_CONTACT_EMAIL` em `src/App.tsx` para o endereço oficial (hoje aponta para o e-mail do admin).
- **Revisão jurídica** do texto da política e dos termos (o rascunho dá transparência mínima, mas não substitui um advogado).
- **Base legal do tratamento de dados de alunos**: como controlador, você/escola deve definir e documentar a base legal (art. 7º/11) e, quando aplicável, obter o consentimento dos responsáveis (art. 14).
- **Política de retenção** (por quanto tempo diário, notas e pareceres ficam guardados) e, idealmente, um **RIPD** por envolver menores e dados sensíveis.
- **Contrato de operador (DPA)** com as escolas, quando houver.
