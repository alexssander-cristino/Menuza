# Operação P1 — backup, monitoramento e recuperação

## Backup PostgreSQL (Neon)

O workflow `.github/workflows/postgres-backup.yml` executa diariamente às 02:17 no horário de Brasília (05:17 UTC) e também pode ser iniciado manualmente.

Configure no GitHub, em **Settings → Secrets and variables → Actions**:

- `DATABASE_URL_DIRECT`: URL de conexão **direta** do Neon, não a URL pooled usada pela aplicação.
- `ALERT_WEBHOOK_URL` (opcional): endpoint de notificação que aceite POST JSON com o campo `text`.

O workflow cria um dump custom-format, valida a listagem do arquivo, restaura em um PostgreSQL 16 isolado e consulta as tabelas essenciais. O artefato fica retido por 30 dias. O teste de restauração nunca escreve no banco de produção.

A execução depende de `DATABASE_URL_DIRECT` configurada. Até o primeiro workflow terminar com sucesso, não considere o backup automático validado.

## Monitoramento

O workflow `.github/workflows/operational-monitoring.yml` consulta a cada cinco minutos:

- `/api/health`: conectividade da API e do PostgreSQL Neon.
- Estado do worker TripoSR: aparece como aviso no Actions quando o worker está configurado, mas não envia heartbeat recente. A indisponibilidade do worker local não mascara a saúde da API e do banco.

A URL padrão é `https://menuza-five.vercel.app/api/health`. A variável de repositório `MENUZA_HEALTH_URL` é opcional e serve apenas para sobrescrever esse endereço. Configure `ALERT_WEBHOOK_URL` como secret para receber notificações externas de falhas da API ou do banco. Sem webhook, a falha aparece no histórico do GitHub Actions.

O worker envia heartbeat ao buscar a fila e a cada 30 segundos durante a inferência. O status é considerado atrasado após 180 segundos. A tabela de heartbeat é criada no primeiro polling autenticado do worker.

## Lembretes por e-mail

O workflow `.github/workflows/abandoned-cart-reminders.yml` chama o endpoint a cada 15 minutos. Para habilitá-lo, configure:

- Secret do GitHub Actions `CRON_SECRET`, com o mesmo valor já configurado em `CRON_SECRET` no Vercel.
- Variável de ambiente Vercel `RESEND_FROM_EMAIL`, usando um remetente/domínio verificado no Resend.
- `RESEND_API_KEY` já deve estar configurada no Vercel.

Sem esses valores, os lembretes não serão enviados. O endpoint exige autenticação e não deve ser exposto sem o segredo.

## Fila 3D

Trabalhos presos em `processing` por mais de 20 minutos voltam para `queued` até três tentativas. Após atingir o limite, são marcados como `failed`, permitindo identificar a falha e solicitar nova geração no painel. A recuperação acontece no próximo polling do worker.

## Relatórios e margem

O painel já possui a seção **Vendas** e o Centro Fiscal com vendas, descontos, ticket médio, modalidades e conciliação manual. Cadastre o custo direto médio unitário (ingredientes e embalagem) no formulário de cada produto/bebida. A margem apresentada considera somente itens com custo cadastrado e usa o custo unitário atual como estimativa para o período; não se deve tratar despesas gerais do mês como custo variável por item. O gateway de pagamento não faz parte deste escopo.

## Impressão

A impressão automática depende do Agente de Impressão Menuza instalado e ativo no computador do restaurante. Se o agente estiver desligado, os IDs das comandas que falharam ficam guardados no navegador e o painel oferece a ação **Reimprimir pendentes** quando o agente voltar. A impressão manual individual continua disponível. Não há como imprimir remotamente enquanto o computador/agente estiver offline.
