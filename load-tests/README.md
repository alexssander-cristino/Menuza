# Testes de carga do Menuza com k6

Os dois cenários fazem requisições **GET** para uma rota configurável. Por padrão, testam `/` (página inicial). Eles não fazem login, não criam pedidos e não alteram dados.

## Pré-requisitos

Instale o k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

Confirme que o Menuza está rodando e, em outro terminal, entre na raiz do repositório.

## Teste com 100 usuários virtuais

Windows PowerShell:

```powershell
$env:BASE_URL="http://localhost:3000"
$env:TARGET_PATH="/"
k6 run .\load-tests\menuza-100.js
```

## Teste com 1.000 usuários virtuais

```powershell
$env:BASE_URL="http://localhost:3000"
$env:TARGET_PATH="/"
k6 run .\load-tests\menuza-1000.js
```

Para testar uma rota pública específica, altere `TARGET_PATH`, por exemplo `/api/health` **somente se essa rota existir no ambiente**.

## Testar outro ambiente

Defina `BASE_URL` com a URL de homologação/staging. Não execute o cenário de 1.000 VUs em produção sem autorização, janela de teste e monitoramento: isso pode gerar custos, acionar limites do provedor ou degradar o serviço de clientes reais.

## O que os limites avaliam

- `http_req_failed`: proporção de requisições com falha.
- `http_req_duration`: latência p95 e p99.
- `checks`: proporção de respostas HTTP 2xx/3xx.

O resultado do k6 mostra VUs, requisições por segundo, latência e falhas. Os limites são metas iniciais, não uma garantia de capacidade. Um VU não equivale necessariamente a um usuário humano simultâneo; cada iteração faz uma requisição e aguarda 1 segundo.

## Fluxo realista de clientes (recomendado)

O cenário `menuza-flow.js` simula uma sessão de cliente com consultas ao cardápio, horários e opções de entrega. Ele espera 90 segundos entre sessões para não transformar todos os VUs em um único IP artificialmente agressivo. O teste é somente leitura por padrão.

PowerShell:

```powershell
$env:BASE_URL="https://SUA-HOMOLOGACAO"
$env:VUS="100"
$env:THINK_TIME_SECONDS="90"
k6 run .\load-tests\menuza-flow.js
```

O cenário sobe gradualmente até 100 VUs, mantém a carga e encerra. Como o k6 normalmente sai de um único IP, o teste respeita o limitador global atual de 240 solicitações por minuto por IP. Um teste distribuído com vários geradores e IPs é necessário para avaliar tráfego vindo de muitas redes diferentes.

### Testar criação de pedidos

Faça isso somente em uma homologação com banco e produtos de teste. O payload deve conter os campos reais exigidos pelo checkout e pelo menos um item existente no catálogo de homologação. Não use dados de clientes reais.

```powershell
$env:BASE_URL="https://SUA-HOMOLOGACAO"
$env:VUS="8"
$env:ENABLE_ORDER_WRITES="true"
$env:ALLOW_TEST_ORDER_WRITES="true"
$env:ORDER_PAYLOAD_JSON='{"customerName":"Cliente de teste","phone":"47999990000","fulfillment":"pickup","paymentMethod":"cash","items":[{"productId":"ID_DO_PRODUTO_DE_TESTE","quantity":1,"sizeKey":"unico","crustKey":"","ingredients":[] }]}'
k6 run .\load-tests\menuza-flow.js
```

O teste com escrita é limitado a 8 VUs para respeitar o limite atual de 60 criações de pedidos por IP em 10 minutos. A chave de idempotência é gerada novamente em cada pedido. O script bloqueia explicitamente a URL de produção conhecida; ainda assim, use apenas homologação isolada.

### Como interpretar

- Meta inicial: menos de 1% de falhas.
- p95 abaixo de 1,5 s e p99 abaixo de 3 s.
- Respostas 429 indicam que um limitador foi atingido; não devem ser confundidas com falhas de banco.
- Compare o resultado com métricas do Neon (conexões, CPU, compute e consultas) e Vercel (duração, erros e throttling).
- Um teste de leitura não comprova integridade de checkout. O cenário com escrita precisa ser conferido no banco: quantidade de pedidos criados, totais e ausência de duplicidades.
- Não execute o cenário de escrita na produção. Para testar concorrência de checkout de forma distribuída, use vários geradores de carga e uma base de homologação.
