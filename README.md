# Menuza

**Cardápio digital interativo para restaurantes.**

O Menuza reúne a experiência do cliente e a operação do restaurante em uma única aplicação: o cliente explora o cardápio, personaliza produtos e acompanha pedidos; a equipe gerencia o catálogo, acompanha a cozinha e organiza o atendimento pelo painel administrativo.

O repositório contém uma instalação demonstrativa configurada para o restaurante **Bela Mesa**. A estrutura inclui interface web, API Node.js, banco SQLite, armazenamento de imagens compatível com S3 e um aplicativo Android em Flutter que utiliza a interface web.

> **Status do projeto:** em desenvolvimento. A configuração atual é uma demonstração de restaurante único — não deve ser considerada uma plataforma multi-restaurante pronta para produção.

## Visão geral

- **Cardápio do cliente:** catálogo responsivo, busca, categorias, promoções e detalhes dos produtos.
- **Personalização:** montagem de pizzas e hambúrgueres, escolha de tamanhos, massas, bordas, ingredientes e adicionais.
- **Carrinho e pedidos:** edição de itens, checkout, registro do pedido e acompanhamento por link.
- **Conta do cliente:** cadastro, autenticação, histórico de pedidos, exportação de dados e solicitação de exclusão da conta.
- **Painel do restaurante:** gerenciamento de produtos e ingredientes, pedidos, mesas, cupons, combos, configurações e fechamento diário.
- **Operação em tempo real:** atualização de pedidos por Server-Sent Events e atualização periódica do acompanhamento do cliente.
- **Visualização 3D:** modelos procedurais interativos para produtos compatíveis, com controles de rotação e zoom.
- **Realidade aumentada:** tentativa de sessão WebXR com detecção de superfície em dispositivos e navegadores compatíveis.
- **QR Code por mesa:** identificação da mesa e abertura do cardápio com o contexto do salão.
- **Impressão de comandas:** integração opcional com um agente local para impressoras compatíveis.
- **Aplicativo Android:** projeto Flutter em `mobile_flutter/`, que carrega a aplicação web em uma WebView.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Aplicação web | HTML, CSS e JavaScript |
| Backend e API | Node.js 22, HTTP nativo |
| Banco de dados | SQLite (`node:sqlite`) |
| Armazenamento de imagens | Neon Object Storage, compatível com S3 |
| Visualização 3D | WebGL, Three.js e modelos procedurais |
| Aplicativo Android | Flutter e WebView |
| Testes | Node.js Test Runner (`node:test`) |
| Hospedagem configurada | Vercel |

## Executar localmente

### Requisitos

- Node.js **22.x**.
- npm.
- Git (opcional, para clonar o repositório).

### Instalação

```bash
git clone https://github.com/alexssander-cristino/Menuza.git
cd Menuza
npm install
```

Configure as variáveis de ambiente antes de iniciar o painel administrativo:

**PowerShell (Windows):**

```powershell
$env:ADMIN_PASSWORD = "uma-senha-local-forte"
$env:APP_SECRET = "uma-chave-aleatoria-com-pelo-menos-32-caracteres"
npm start
```

**Linux / macOS:**

```bash
export ADMIN_PASSWORD="uma-senha-local-forte"
export APP_SECRET="uma-chave-aleatoria-com-pelo-menos-32-caracteres"
npm start
```

A aplicação ficará disponível em:

- Cardápio: http://localhost:4173
- Painel: opção **Área do restaurante** na interface.

Para desenvolvimento com reinício automático:

```bash
npm run dev
```

O banco SQLite é criado automaticamente no primeiro início, no caminho padrão `data/mesa.sqlite`.

### Variáveis de ambiente

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `PORT` | Porta HTTP do servidor local | `4173` |
| `DATA_FILE` | Caminho do arquivo SQLite | `data/mesa.sqlite` |
| `ADMIN_PASSWORD` | Senha de acesso ao painel | Sem senha padrão recomendada |
| `APP_SECRET` | Segredo para assinatura das sessões | Gerado temporariamente no início |
| `ADMIN_TOTP_SECRET` | Segredo Base32 para autenticação TOTP | Segundo fator desativado |
| `NODE_ENV` | Ambiente de execução | Desenvolvimento |
| `AWS_ENDPOINT_URL_S3` | Endpoint S3 do Neon Object Storage | — |
| `AWS_ACCESS_KEY_ID` | Chave de acesso do armazenamento | — |
| `AWS_SECRET_ACCESS_KEY` | Chave secreta do armazenamento | — |
| `AWS_REGION` | Região do armazenamento | `us-east-2` |
| `MENUZA_STORAGE_BUCKET` | Bucket usado para imagens | `menuza-modelos-3d` |
| `TRUST_PROXY` | Confia nos cabeçalhos de IP do proxy | Desativado |
| `RESEND_API_KEY` | Chave de API do Resend para lembretes de carrinho | — |
| `RESEND_FROM_EMAIL` | Remetente verificado no Resend (ex.: Menuza <pedidos@seudominio.com>) | — |
| `CRON_SECRET` | Segredo usado para autenticar a rotina agendada de lembretes | — |
| `MENUZA_PUBLIC_URL` | URL pública incluída no e-mail de lembrete | `https://menuza-five.vercel.app` |

O armazenamento de imagens depende das credenciais do Neon Object Storage. Sem essa configuração, operações que enviam imagens para o bucket não funcionarão.

### Lembrete de carrinho e conciliação de pagamentos

O checkout permite escolher Pix, dinheiro ou cartão e, no painel, registrar manualmente quando o restaurante recebeu o pagamento. O fechamento diário e o relatório fiscal gerencial exibem valores recebidos e pendentes. Essa baixa é um registro operacional, não uma confirmação bancária.

O lembrete de carrinho é opcional e exige que o cliente marque a autorização no checkout. Para ativar o envio, configure no ambiente de produção as variáveis `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (remetente/domínio verificado no Resend) e `CRON_SECRET`. A rotina da Vercel verifica os lembretes a cada 30 minutos e envia no máximo uma mensagem por carrinho autorizado, após aproximadamente 45 minutos. Pedidos concluídos cancelam o lembrete pendente. `MENUZA_PUBLIC_URL` é opcional e define o endereço do cardápio incluído na mensagem.

## Funcionalidades em detalhe

### Experiência do cliente

- Navegação por categorias, busca, filtros e ordenação.
- Personalização de produtos com atualização de preço conforme as escolhas.
- Carrinho com alteração de quantidades e edição dos itens.
- Checkout para retirada, entrega ou consumo no salão.
- Consulta do andamento do pedido por token de acompanhamento.
- Cadastro e login de clientes, com histórico e recursos de privacidade.

### Gestão do restaurante

- Cadastro e edição de produtos, imagens, ingredientes e adicionais.
- Controle de disponibilidade e preços.
- Gestão de pedidos e atualização de status conforme o fluxo permitido.
- Mesas com estados livre, ocupada e em limpeza.
- QR Code individual para as mesas.
- Cadastro e gerenciamento de cupons e combos.
- Indicadores e fechamento diário.
- Solicitações relacionadas à privacidade dos dados dos clientes.

### Modelos 3D e realidade aumentada

Os modelos são construídos proceduralmente e respondem às opções selecionadas pelo cliente. A visualização oferece rotação, inclinação e zoom, sem depender de uma imagem estática para simular o movimento.

O recurso de realidade aumentada utiliza WebXR e hit-test quando o navegador e o dispositivo oferecem suporte. O acesso à câmera só é solicitado após a ação do usuário. Em dispositivos incompatíveis, a prévia 3D continua disponível.

**Importante:** os modelos procedurais são representações visuais dos produtos, não digitalizações fotográficas fiéis de cada receita. As dimensões cadastradas influenciam a escala e devem ser conferidas antes do uso operacional.

### Impressão de comandas

O agente de impressão está em `print-agent/`. Ele roda no computador conectado à impressora e recebe os novos pedidos detectados pelo painel.

Consulte o [guia de instalação e configuração do agente](print-agent/README.md) para configurar impressoras instaladas no Windows ou impressoras de rede compatíveis com ESC/POS.

A impressão automática depende do painel aberto e autenticado no computador conectado ao agente. Esta versão não reenvia automaticamente pedidos que chegaram enquanto o agente ou a impressora estavam indisponíveis.

## Aplicativo Android

O projeto Flutter está em `mobile_flutter/`. O aplicativo utiliza uma WebView para abrir a interface do Menuza, mantendo a experiência web e evitando uma segunda implementação visual.

### Testar na rede local

1. Inicie o servidor no computador com `npm start`.
2. Conecte o computador e o celular à mesma rede Wi-Fi.
3. Descubra o IPv4 do computador com `ipconfig` no Windows.
4. Informe o endereço do servidor na tela de conexão do aplicativo, usando a porta `4173`.

O backend e o banco SQLite continuam executando no computador. O APK não inclui o servidor.

### Gerar APK

O workflow [Build Menuza Flutter APK](https://github.com/alexssander-cristino/Menuza/actions/workflows/android-apk.yml) executa análise, testes e compilação quando há alterações em `mobile_flutter/`.

Para compilar localmente, com Flutter e Android SDK instalados:

```powershell
cd mobile_flutter
flutter pub get
flutter build apk --debug
```

O APK será gerado em `mobile_flutter/build/app/outputs/flutter-apk/app-debug.apk`.

## API

A API utiliza a mesma origem da aplicação. Entre as rotas principais estão:

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/catalog` | Catálogo e opções disponíveis |
| `POST` | `/api/orders` | Criação de pedido |
| `GET` | `/api/tracking/:token` | Acompanhamento de pedido |
| `POST` | `/api/admin/login` | Autenticação administrativa |
| `POST` | `/api/admin/logout` | Encerramento da sessão |
| `GET` | `/api/admin/me` | Verificação da sessão |
| `GET` | `/api/admin/dashboard` | Dados do painel |
| `GET` | `/api/admin/orders` | Lista de pedidos |
| `GET` | `/api/admin/events` | Eventos em tempo real |
| `PATCH` | `/api/admin/orders/:id` | Atualização do status do pedido |
| `GET` | `/api/admin/catalog` | Catálogo para administração |

As rotas administrativas exigem sessão válida. Os endpoints de cliente também aplicam autenticação quando necessário.

## Testes

Execute a suíte automatizada com:

```bash
npm test
```

Os testes usam `node:test` e banco SQLite temporário. A cobertura inclui regras de preço, composição dos produtos, autenticação, autorização, cadastro de clientes, checkout, cupons, mesas, idempotência, atualização de pedidos e recuperação após reinicialização.

O projeto Flutter também possui testes próprios:

```bash
cd mobile_flutter
flutter test
```

## Backup do banco de dados

Para gerar um snapshot consistente do SQLite:

```bash
npm run backup
```

Por padrão, os arquivos são salvos em `backups/`.

| Variável | Finalidade | Padrão |
| --- | --- | --- |
| `BACKUP_DIR` | Diretório de destino | `backups/` |
| `BACKUP_KEEP` | Quantidade de snapshots gerenciados | `14` |

O script valida o banco de origem e o snapshot antes de aplicar a retenção. Para restaurar, pare o servidor, preserve uma cópia do banco atual, valide o backup e só então substitua o arquivo configurado em `DATA_FILE`.

Mantenha também uma cópia em outro dispositivo ou serviço protegido. Um backup armazenado apenas na mesma máquina não protege contra perda ou falha do disco.

## Segurança e configuração de produção

O projeto inclui controles como:

- Sessões administrativas assinadas por HMAC e cookies protegidos em produção.
- Autenticação TOTP opcional para o painel.
- Limitação de tentativas e requisições, com resposta HTTP 429.
- Validação de origem, limite de tamanho do corpo e timeouts HTTP.
- Cabeçalhos de segurança e política de conteúdo (CSP).
- Proteção contra automações simples por honeypot.
- Validação de imagens antes do armazenamento.
- Separação de consultas pelo identificador do restaurante configurado.

Antes de disponibilizar a aplicação publicamente:

1. Configure `NODE_ENV=production`.
2. Defina `ADMIN_PASSWORD` com uma senha exclusiva de pelo menos 14 caracteres.
3. Defina `APP_SECRET` com um valor aleatório forte de pelo menos 32 caracteres.
4. Configure o Neon Object Storage e mantenha as credenciais somente no ambiente do servidor.
5. Use HTTPS, backups externos, monitoramento e controle de acesso à infraestrutura.
6. Configure corretamente o proxy confiável antes de ativar `TRUST_PROXY`.
7. Teste o fluxo de pedidos, imagens, QR Codes e impressão no ambiente real.

Para habilitar TOTP, configure `ADMIN_TOTP_SECRET` com uma chave **Base32** gerada por um método confiável e cadastre a mesma chave no aplicativo autenticador. Não publique esse segredo em commits, logs ou mensagens.

### Limitações atuais

Esta versão é uma instalação demonstrativa de restaurante único. Antes de utilizá-la como serviço comercial para vários estabelecimentos, ainda é necessário projetar e validar, entre outros pontos:

- Isolamento multi-tenant completo e gestão independente de estabelecimentos.
- Banco de dados compartilhado e persistente adequado ao ambiente de hospedagem escolhido.
- Integração real de pagamentos e conciliação.
- Regras de entrega e cálculo de frete.
- Rotinas operacionais, monitoramento e recuperação para produção.
- Revisão de segurança, privacidade e requisitos legais do cenário de implantação.

O projeto contém configuração para Vercel, mas o banco SQLite local não deve ser tratado como armazenamento persistente em funções serverless. Planeje a migração para um banco gerenciado antes de operar nesse modelo.

## Estrutura do projeto

```text
Menuza/
├── api/                 # Adaptadores das rotas para a Vercel
├── backups/             # Destino padrão dos backups (gerado)
├── data/                # Banco SQLite local (gerado)
├── migrations/          # Schema e migrações SQL
├── mobile_flutter/      # Aplicativo Android em Flutter
├── print-agent/         # Agente local de impressão
├── public/              # Interface web, estilos e recursos
├── scripts/             # Scripts auxiliares e backup
├── src/                 # Regras de negócio, autenticação e storage
├── package.json
└── server.mjs           # Servidor HTTP local
```

## Licença

Consulte os arquivos do repositório para informações de licenciamento e avisos de dependências de terceiros.
