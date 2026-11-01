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
