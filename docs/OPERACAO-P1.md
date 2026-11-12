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

- `/api/health?worker=1`: conectividade da API e do Neon.
- Heartbeat do worker TripoSR quando `TRIPOSR_WORKER_TOKEN` está configurado.

Configure a variável de repositório `MENUZA_HEALTH_URL` com a URL base completa, por exemplo `https://menuza-five.vercel.app/api/health`. Configure `ALERT_WEBHOOK_URL` como secret para receber alertas. Sem webhook, a falha aparece no histórico do GitHub Actions.

O worker envia heartbeat ao buscar a fila e a cada 30 segundos durante a inferência. O status é considerado atrasado após 180 segundos. Se o worker não estiver configurado, ele é tratado como recurso opcional e não derruba a saúde da API.

## Fila 3D

Trabalhos presos em `processing` por mais de 20 minutos voltam para `queued` até três tentativas. Após atingir o limite, são marcados como `failed`, permitindo identificar a falha e solicitar nova geração no painel. A recuperação acontece no próximo polling do worker.

## Relatórios e margem

O painel já possui a seção **Vendas** e o Centro Fiscal com vendas, descontos, ticket médio, modalidades e conciliação manual. Cadastre o custo direto médio unitário (ingredientes e embalagem) no formulário de cada produto/bebida. A margem apresentada considera somente itens com custo cadastrado e usa o custo unitário atual como estimativa para o período; não se deve tratar despesas gerais do mês como custo variável por item. O gateway de pagamento não faz parte deste escopo.

## Impressão

A impressão automática depende do Agente de Impressão Menuza instalado e ativo no computador do restaurante. Se o agente estiver desligado, a comanda ainda pode ser impressa manualmente no painel. Não há como garantir impressão remota enquanto o computador/agente estiver offline.
