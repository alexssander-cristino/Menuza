# Menuza: migração para Vercel + Neon

## Estado real

O runtime atual em `server.mjs` não é compatível diretamente com Vercel Functions: ele abre um servidor HTTP permanente com `server.listen`, usa `node:sqlite` / `DatabaseSync`, executa migrações SQLite no boot e mantém conexões SSE em memória. A Vercel não oferece disco local persistente para esse banco.

O schema PostgreSQL e a ferramenta de migração SQLite → PostgreSQL ficam na base desta branch. Isso ainda não significa que o runtime da aplicação esteja migrado.

## Arquitetura alvo

- Frontend: arquivos existentes em `public/`, publicados pela Vercel.
- API: funções Node.js em `api/`, usando `@neondatabase/serverless` e `DATABASE_URL`.
- Dados: Neon PostgreSQL; aplicar `migrations/postgres/001_initial.sql` em um banco novo antes de importar dados.
- Segredos: `APP_SECRET` e `ADMIN_PASSWORD` somente em Environment Variables da Vercel; nunca versionar credenciais.
- Eventos do painel: não depender de conexões SSE ou de memória local do processo como mecanismo de consistência; adicionar fallback de atualização por polling, preservando a atualização imediata quando disponível.

## Ordem obrigatória da migração

1. Implementar e testar o acesso PostgreSQL assíncrono e as rotas de leitura.
2. Migrar autenticação de cliente/admin, rate limits e sessões sem enfraquecer os controles existentes.
3. Migrar operações transacionais de checkout, idempotência, uso de cupons, atualização de pedidos e exclusão de conta.
4. Migrar gerenciamento de produtos, ingredientes, combos, mesas, configurações e solicitações de privacidade.
5. Adaptar eventos do painel para o modelo de funções serverless.
6. Criar configuração Vercel e rewrites apenas quando a API estiver funcional.
7. Executar testes automatizados e smoke tests; importar dados apenas para um banco de destino vazio, com backup da origem.

## Regras para evitar regressões

- Não substituir a camada SQLite por uma falsa API síncrona: chamadas PostgreSQL são assíncronas.
- Não fazer busca-e-substituição global de `?` para `$1`; cada consulta precisa ter seus parâmetros revisados.
- Operações que exigem atomicidade devem usar uma transação PostgreSQL real em uma única conexão.
- Não alegar deploy, migração de dados ou testes de integração até serem executados e verificados.
- Não remover nem alterar os fluxos existentes de checkout, cupons, combos, QR Code/mesas, autenticação e histórico de pedidos sem testes equivalentes.
