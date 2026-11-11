# Menuza

**Cardápio digital e sistema de operação para restaurante.**

O Menuza conecta o cardápio que o cliente utiliza à operação diária do restaurante. O cliente consulta produtos, personaliza itens, monta o carrinho, conclui pedidos e acompanha o andamento. A equipe administra o catálogo, recebe pedidos, organiza a produção, registra pagamentos e consulta relatórios.

O projeto está configurado para **uma única operação de restaurante**. Não há gestão multi-restaurante nem módulo de estoque.

- **Produção:** [menuza-five.vercel.app](https://menuza-five.vercel.app)
- **Repositório:** [alexssander-cristino/Menuza](https://github.com/alexssander-cristino/Menuza)
- **Documentação completa:** [Como o Menuza funciona](docs/COMO-O-MENUZA-FUNCIONA.md)

## O que o sistema oferece

### Para o cliente
- Cardápio responsivo com categorias, busca, promoções e detalhes dos produtos.
- Personalização de pizzas, hambúrgueres e outros produtos cadastrados.
- Escolha de tamanhos, massas, bordas, ingredientes e adicionais conforme a configuração do restaurante.
- Carrinho, cupons e checkout para as modalidades de atendimento habilitadas.
- Conta de cliente, histórico de pedidos e recursos de privacidade.
- Acompanhamento do pedido por link/token.
- Visualização 3D e realidade aumentada quando o produto, navegador e dispositivo oferecem suporte.

### Para o restaurante
- Cadastro e edição de produtos, categorias, ingredientes, adicionais e imagens.
- Configuração de tamanhos e preços de pizza, promoções, combos, cupons e banner.
- Gestão de pedidos e atualização de status.
- Configuração de horários, modalidades de atendimento, mesas e QR Codes.
- Configuração de entrega por regiões e distância.
- Registro manual de recebimentos em Pix, dinheiro ou cartão.
- Fechamento diário, relatórios gerenciais e indicadores de clientes.
- Histórico de atividades administrativas.
- Gestão de solicitações de privacidade.
- Impressão de comandas por agente local opcional.

## Arquitetura atual

| Camada | Tecnologia / responsabilidade |
| --- | --- |
| Interface | HTML, CSS e JavaScript em `public/` |
| API de produção | Node.js em Vercel Functions, roteada por `api/[...path].mjs` |
| Banco de produção | PostgreSQL gerenciado pelo Neon |
| Conexão com banco | `@neondatabase/serverless`, em `src/db/postgres.mjs` |
| Imagens e modelos | Neon Object Storage, API compatível com S3 |
| Modelos 3D | Three.js / model-viewer e worker TripoSR opcional |
| Aplicativo Android | Flutter com WebView em `mobile_flutter/` |
| Impressão | Agente Node.js local em `print-agent/` |
| Hospedagem | Vercel |

A API de produção usa PostgreSQL/Neon. O arquivo `server.mjs` mantém um servidor local baseado em SQLite para desenvolvimento e compatibilidade; ele não é o runtime usado pelas funções de produção. O schema PostgreSQL está em `migrations/postgres/`.

## Começar a desenvolver

### Requisitos
- Node.js 22.x.
- npm.
- Conta/projeto Neon com PostgreSQL.
- Vercel CLI para executar a aplicação pelo mesmo adaptador usado na hospedagem.

### Instalação

```bash
git clone https://github.com/alexssander-cristino/Menuza.git
cd Menuza
npm install
```

Crie `.env.local` na raiz do projeto. Exemplo mínimo:

```dotenv
DATABASE_URL="postgresql://..."
ADMIN_PASSWORD="uma-senha-administrativa-forte"
APP_SECRET="gere-um-segredo-aleatorio-com-pelo-menos-32-caracteres"
```

Aplique o schema PostgreSQL em um banco Neon novo antes de executar a aplicação:

```text
migrations/postgres/001_initial.sql
```

Inicie o ambiente local com Vercel Dev:

```bash
npx vercel dev --listen 3000
```

Acesse:
- Cardápio: http://localhost:3000
- Verificação da API e do banco: http://localhost:3000/api/health
- Painel: opção **Área do restaurante** no cardápio.

O endpoint de saúde deve indicar `ok: true` e `database: "connected"`. Para detalhes, consulte [Execução local e implantação](docs/COMO-O-MENUZA-FUNCIONA.md#desenvolvimento-local).

> Não compartilhe nem versione `.env.local`. Use variáveis de ambiente do projeto para Preview e Production.

## Configuração de produção

No projeto da Vercel, configure as variáveis necessárias em **Settings → Environment Variables**. As principais são:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL do Neon |
| `ADMIN_PASSWORD` | Senha administrativa |
| `APP_SECRET` | Assinatura de sessões e proteção de segredos; mínimo de 32 caracteres |
| `AWS_ENDPOINT_URL_S3` | Endpoint S3 do Neon Object Storage |
| `AWS_ACCESS_KEY_ID` | Credencial S3 privada |
| `AWS_SECRET_ACCESS_KEY` | Segredo S3 privado |
| `AWS_REGION` | Região do bucket |
| `MENUZA_STORAGE_BUCKET` | Bucket de arquivos; padrão `menuza-modelos-3d` |
| `RESEND_API_KEY` | Envio de lembretes de carrinho |
| `RESEND_FROM_EMAIL` | Remetente verificado no Resend |
| `CRON_SECRET` | Autenticação da rotina agendada |
| `MENUZA_PUBLIC_URL` | URL do cardápio nos e-mails |
| `ADMIN_TOTP_SECRET` | Segredo TOTP externo opcional |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Proteção antirrobô Cloudflare Turnstile |
| `TRIPOSR_WORKER_TOKEN` | Autenticação do worker de modelos 3D |
| `SENTRY_DSN` / `GA_MEASUREMENT_ID` | Monitoramento e métricas, quando habilitados |

A lista completa, regras, valores e passos de ativação estão na [documentação de configuração](docs/COMO-O-MENUZA-FUNCIONA.md#variaveis-de-ambiente).

### Lembrete de carrinho

O cliente precisa estar autenticado e marcar voluntariamente a autorização no checkout. O sistema agenda um único lembrete para aproximadamente 45 minutos depois. O Vercel Schedule consulta a fila a cada 15 minutos, autenticado por `CRON_SECRET`, e o Resend envia a mensagem. A conclusão do pedido cancela o lembrete pendente.

Para ativar, configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL` e `CRON_SECRET`; depois faça um novo deploy e confira **Settings → Cron Jobs** na Vercel. O agendamento está declarado em `vercel.json`. Veja [o fluxo detalhado](docs/COMO-O-MENUZA-FUNCIONA.md#lembretes-de-carrinho).

## Pagamentos e relatórios

O checkout registra a forma escolhida pelo cliente (Pix, dinheiro ou cartão). A equipe confirma manualmente no painel se recebeu o valor. Fechamento e relatórios separam valores recebidos e pendentes.

**Isso não é uma integração com adquirente, banco ou gateway.** A baixa manual não confirma uma transação bancária e não substitui comprovantes, extratos ou documento fiscal autorizado. O relatório fiscal do Menuza é gerencial; emissão fiscal oficial exige integração própria e validação contábil.

## Testes

```bash
npm test
```

Os testes usam o test runner nativo do Node.js. O workflow de CI também verifica a sintaxe dos principais arquivos JavaScript.

Para o aplicativo Flutter:

```bash
cd mobile_flutter
flutter pub get
flutter test
```

## Módulos complementares

- [Worker TripoSR](worker/README.md): geração de modelos GLB em computador com GPU NVIDIA.
- [Agente de impressão](print-agent/README.md): impressão local de comandas em impressoras compatíveis.
- [Armazenamento de imagens](docs/NEON_OBJECT_STORAGE.md): bucket, credenciais e fluxo de upload.
- [Migração e banco Neon](docs/VERCEL_NEON_MIGRATION.md): schema e migração de dados.
- [Guia completo de arquitetura e operação](docs/COMO-O-MENUZA-FUNCIONA.md).

## Estrutura do repositório

```text
Menuza/
├── api/                 # Adaptadores e roteador da API Vercel
├── docs/                # Documentação técnica e operacional
├── migrations/          # Schemas SQL e migrações
├── mobile_flutter/      # Aplicativo Android
├── print-agent/         # Agente local de impressão
├── public/              # Interface web, estilos e recursos
├── scripts/             # Migração, backup e utilitários
├── src/
│   ├── db/              # Conexão PostgreSQL/Neon
│   ├── security/        # Segurança e limitação de requisições
│   └── storage/         # Integração com Neon Object Storage
├── worker/              # Worker local TripoSR
├── server.mjs           # Servidor local SQLite
├── vercel.json          # Configuração Vercel e agendamento
└── package.json
```

## Escopo e limitações importantes

- A configuração atual atende a um único restaurante.
- Não existe módulo de estoque.
- A conciliação de pagamentos é manual; não há gateway de pagamento conectado.
- A geração TripoSR depende de um worker local ligado e autenticado.
- A impressão automática depende do agente e do computador conectados.
- WebXR/realidade aumentada depende do suporte do navegador e do dispositivo.
- O aplicativo Android é uma WebView; o backend continua hospedado separadamente.
- A implantação deve ser validada com as variáveis e o banco do ambiente de destino antes de ser considerada operacional.

## Licença

Consulte os arquivos do repositório e os avisos das dependências de terceiros antes de redistribuir o projeto.
