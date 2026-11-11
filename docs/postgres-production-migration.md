# Migração de produção: PostgreSQL + serviço Node.js

Este projeto ainda usa `node:sqlite` de forma síncrona em `server.mjs`. A presença do schema PostgreSQL não significa que a API já esteja conectada ao PostgreSQL. Não configure o deploy de produção para apontar a API para esse banco até que a camada de acesso a dados seja migrada e os testes sejam executados.

## Arquitetura alvo

- **Frontend:** Vercel, servindo os arquivos estáticos de `public/`.
- **API:** serviço Node.js de longa duração (Render ou Railway), necessário para preservar os endpoints e o fluxo SSE usado pelo painel.
- **Banco:** PostgreSQL gerenciado pelo mesmo provedor ou por um provedor PostgreSQL compatível.
- **APK Flutter:** continua abrindo a URL HTTPS pública; o endereço da API deve permanecer na mesma origem do frontend ou ser configurado para a URL pública da API.

## Schema PostgreSQL

O schema inicial convertido está em `migrations/postgres/001_initial.sql`. Ele inclui as tabelas do schema SQLite inicial e as tabelas/colunas adicionais criadas em runtime pelo servidor: clientes, combos, cupons, mesas/QR, solicitações de privacidade, limites de segurança, logo e dados de cliente/desconto dos pedidos.

O schema mantém flags como `active` e `available` como inteiros 0/1 na primeira etapa para reduzir mudanças na lógica de negócio. O histórico usa `BIGSERIAL` no lugar de `INTEGER PRIMARY KEY AUTOINCREMENT`.

## Ordem segura da migração

1. Migrar a camada de acesso a dados do servidor para consultas assíncronas PostgreSQL, sem alterar os contratos HTTP.
2. Portar as migrações e seed para PostgreSQL; substituir construções específicas de SQLite (`PRAGMA`, placeholders `?`, `INSERT OR IGNORE`, e diferenças de retorno de `run`).
3. Preparar o PostgreSQL com o schema e migrar o banco SQLite existente com `scripts/migrate-sqlite-to-postgres.mjs`. A ferramenta exige confirmação explícita, valida a integridade do SQLite, usa uma transação PostgreSQL e confere contagens antes do commit. Rode primeiro em um banco de destino vazio; não use um banco de produção já populado como destino.
4. Executar a suíte de testes, incluindo concorrência de cupons, idempotência de checkout, sessão de cliente, mesas/QR, eventos SSE e permissões administrativas.
5. Configurar o serviço Node.js e as variáveis no provedor; configurar a Vercel para publicar apenas o frontend; validar health check, login, pedido completo e persistência após reinício.
6. Só depois da validação, mudar o domínio público e o endereço usado pelo APK.

## Variáveis planejadas para o backend

- `NODE_ENV=production`
- `DATABASE_URL`: string de conexão do PostgreSQL fornecida pelo provedor.
- `ADMIN_PASSWORD`: senha administrativa longa e exclusiva.
- `APP_SECRET`: segredo aleatório forte (pelo menos 32 caracteres).
- `ADMIN_TOTP_SECRET`: opcional, para autenticação TOTP.
- `TRUST_PROXY=true`: somente se o proxy reverso confiável for configurado para sobrescrever `X-Forwarded-For`.

**Não apague nem deixe de fazer backup do arquivo SQLite original** até que a migração de dados tenha sido validada e a produção tenha sido conferida.


## Migração de dados (ferramenta inicial)

A ferramenta `scripts/migrate-sqlite-to-postgres.mjs` copia as tabelas conhecidas em ordem de dependência e preserva IDs, snapshots e registros históricos. Ela **não altera nem apaga** o SQLite de origem.

Pré-requisitos:
- Backup validado do arquivo SQLite.
- PostgreSQL de destino com `migrations/postgres/001_initial.sql` aplicado.
- Dependências instaladas com `npm install`; a ferramenta usa o driver `@neondatabase/serverless` já declarado no projeto.
- Banco PostgreSQL de destino vazio nas tabelas Menuza. Faça um ensaio com uma cópia antes de usar dados reais.

Exemplo no PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://USUARIO:SENHA@HOST:5432/BANCO?sslmode=require"
$env:CONFIRM_SQLITE_TO_POSTGRES_MIGRATION = "yes"
node scripts/migrate-sqlite-to-postgres.mjs
```

A ferramenta não deve ser executada contra o banco de produção enquanto o servidor ainda grava no SQLite. Ela migra dados, mas não troca por si só a camada de persistência da API.
