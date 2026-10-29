# Migração do Menuza para Vercel + Neon

## O que esta etapa entrega

- O app estático é publicado a partir de `public/`.
- As rotas de API serverless usam Neon/PostgreSQL; o servidor SQLite continua disponível para desenvolvimento local.
- `api/health.mjs` verifica a conexão real com o banco.
- `api/[...path].mjs` implementa os endpoints de cliente, pedidos, rastreio, painel, produtos, adicionais, combos, cupons, mesas e solicitações de privacidade.
- O script de importação transfere os dados atuais do SQLite para PostgreSQL sem sobrescrever registros conflitantes.

## Configuração necessária no Neon

1. Crie um banco PostgreSQL no Neon.
2. Execute todo o arquivo `migrations/postgres/001_initial.sql` no SQL Editor do Neon.
3. **Antes de executar o seed**, importe o banco SQLite que contém os dados reais. Faça uma cópia de segurança do arquivo `data/mesa.sqlite`.
4. Na raiz do projeto local, configure `DATABASE_URL` com a connection string pooled do Neon e execute:

   ```powershell
   $env:DATABASE_URL="postgresql://..."
   $env:DATA_FILE="C:\caminho\para\data\mesa.sqlite"
   $env:CONFIRM_SQLITE_TO_POSTGRES_MIGRATION="yes"`r`n   node scripts/migrate-sqlite-to-postgres.mjs
   ```

5. Se o banco Neon estiver vazio e não houver banco SQLite para importar, execute `node scripts/migrate-neon.mjs` para criar os dados de demonstração. Não execute o seed de demonstração antes da importação de produção.
6. No projeto Vercel, configure `DATABASE_URL`, `APP_SECRET` (mínimo 32 caracteres aleatórios) e `ADMIN_PASSWORD` (mínimo 14 caracteres). Configure `ADMIN_TOTP_SECRET` somente se o segundo fator estiver habilitado.
7. Faça deploy e valide `/api/health`, login, cadastro de cliente, catálogo, pedido com idempotência, rastreio, transição de status, cupons, QR de mesa e painel.

## Importante

- Não coloque credenciais no Git nem em mensagens. Use as variáveis de ambiente do Vercel.
- O script de migração exige confirmação explícita, valida a integridade do SQLite, exige um destino vazio e usa uma transação para evitar misturar dados. Revise os totais informados antes de colocar o tráfego em produção.
- A migração de dados e a implantação não são consideradas concluídas até validar os fluxos reais com as variáveis de ambiente e o banco Neon configurados.
- A hospedagem serverless não mantém conexões SSE permanentes. O endpoint de eventos abre uma conexão curta para compatibilidade; a interface deve continuar usando o polling de contingência.
