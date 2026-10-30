# Agente de Impressão Menuza

O agente roda no computador do restaurante. Quando o painel Menuza detecta um pedido novo com status **Recebido**, envia a comanda para `127.0.0.1:17891`. O agente imprime sem abrir a janela do navegador e mantém um histórico local de IDs já impressos para impedir duplicidade após reconexões/recarregamentos.

## Requisitos

- Windows 10/11 ou sistema com Node.js 22+.
- Computador ligado, com o painel Menuza aberto e autenticado.
- Impressora térmica instalada no sistema ou impressora de rede ESC/POS com porta TCP 9100 habilitada.
- O navegador deve permitir acesso a localhost; o agente valida a origem do painel.

## Windows / USB

1. Instale a impressora e o driver no Windows. Faça uma página de teste pelas configurações do sistema.
2. Abra PowerShell nesta pasta.
3. Copie `.env.example` para `.env` e configure `PRINTER_TYPE=windows`. Se houver mais de uma impressora, informe o nome exato em `PRINTER_NAME`.
4. Execute `npm start`.
5. Deixe o agente e o painel Menuza abertos. Faça um pedido de teste.

O agente encaminha texto ao spooler do Windows usando a impressora padrão ou o nome informado. A formatação final depende do driver instalado.

## Impressora Wi-Fi / Ethernet ESC/POS

1. Configure um IP fixo/reservado para a impressora.
2. Copie `.env.example` para `.env`, defina `PRINTER_TYPE=network`, `PRINTER_HOST=IP_DA_IMPRESSORA` e, se necessário, `PRINTER_PORT=9100`.
3. Execute `npm start` e faça um pedido de teste.

Este modo envia comandos ESC/POS básicos diretamente à porta TCP. A impressora precisa aceitar ESC/POS e impressão RAW nessa porta.

## Segurança e operação

- O servidor escuta somente em loopback (127.0.0.1), não fica exposto na rede.
- Requisições do navegador são limitadas às origens Menuza configuradas.
- O agente aceita apenas pedidos recebidos, valida os dados básicos e guarda os últimos 2.000 IDs impressos em `%USERPROFILE%/.menuza-print-agent/printed-orders.json`.
- Pedidos antigos já existentes quando o painel abre não são impressos; somente novos pedidos detectados depois da inicialização do painel.
- Se o agente ou impressora estiver offline no momento da chegada, o pedido continua no Menuza, mas esta primeira versão não faz reenvio automático após a falha. Use o botão de impressão manual até reativar o agente.
- O painel consulta os pedidos periodicamente; o tempo até impressão depende da atualização do painel e da conexão.
- A impressão automática só funciona enquanto o painel estiver aberto e autenticado no computador conectado à impressora.

## Diagnóstico

Abra `http://127.0.0.1:17891/health` no mesmo computador. Deve retornar JSON com `ok: true`. Se não imprimir, confira o nome da impressora, driver, fila do Windows ou IP/porta da impressora.
