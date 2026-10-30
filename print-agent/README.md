# Agente de Impressão Menuza

O agente roda no computador do restaurante. Quando o painel Menuza detecta um pedido novo com status **Recebido**, envia a comanda para `127.0.0.1:17891`. O agente imprime sem abrir a janela do navegador e mantém um histórico local de IDs já impressos para impedir duplicidade após reconexões/recarregamentos.

## Compatibilidade Epson

O agente oferece dois caminhos:

- **USB / impressora instalada no Windows:** `PRINTER_TYPE=epson-usb`. Instale o driver oficial da Epson, selecione a impressora padrão ou informe o nome exato em `PRINTER_NAME`. O Windows encaminha o texto ao driver; a formatação e o corte dependem das opções do driver.
- **Ethernet / Wi-Fi:** `PRINTER_TYPE=epson-network`. Envia comandos ESC/POS diretamente para a porta TCP configurada (normalmente 9100), incluindo inicialização, alinhamento, negrito, destaque de texto e corte.

Perfis de largura disponíveis em `EPSON_MODEL`:
- `auto`: 42 colunas, opção inicial recomendada enquanto o modelo é desconhecido.
- `tm-t20`: 42 colunas (TM-T20, TM-T20II e TM-T20III).
- `tm-t88`: 48 colunas.
- `tm-m30`: 42 colunas.
- `tm-u220`: 32 colunas (matricial).

A seleção de perfil ajusta a largura do texto. Não é uma detecção automática do modelo físico: confirme o modelo na etiqueta da impressora e ajuste o perfil. A compatibilidade ESC/POS, o corte e a porta de rede variam conforme a interface e configuração do equipamento.

## Instalação no Windows

1. Instale o Node.js 22 ou superior.
2. Instale a impressora Epson e seu driver no Windows. Faça uma página de teste nas configurações do sistema.
3. Abra PowerShell nesta pasta e copie `.env.example` para `.env`.
4. Para USB, configure `PRINTER_TYPE=epson-usb`, `EPSON_MODEL=auto` e, se necessário, `PRINTER_NAME` com o nome exibido pelo Windows.
5. Para rede, configure `PRINTER_TYPE=epson-network`, `PRINTER_HOST` com o IP da impressora e `PRINTER_PORT=9100`.
6. Execute `npm start`.
7. Deixe o agente e o painel Menuza abertos no computador conectado à impressora.

## Operação e limitações

- O servidor escuta somente em loopback (`127.0.0.1`).
- Requisições do navegador são limitadas às origens Menuza configuradas.
- O agente aceita apenas pedidos recebidos, valida os dados básicos e guarda os últimos 2.000 IDs impressos em `%USERPROFILE%/.menuza-print-agent/printed-orders.json`.
- Pedidos antigos já existentes quando o painel abre não são impressos; somente novos pedidos detectados depois da inicialização do painel.
- Se o agente ou a impressora estiver offline na chegada do pedido, esta versão não faz reenvio automático. Use a impressão manual até reativar o agente.
- O painel consulta os pedidos periodicamente; o tempo até impressão depende da atualização do painel e da conexão.
- A impressão automática só funciona enquanto o painel estiver aberto e autenticado no computador conectado à impressora.
- A impressão física deve ser testada no modelo real antes de colocar em operação.

## Diagnóstico

Abra `http://127.0.0.1:17891/health` no mesmo computador. A resposta informa o tipo e perfil configurados. Se não imprimir, confira o driver, o nome da fila do Windows ou o IP/porta da impressora.
