# Menuza — Fidelidade e relacionamento (P2)

## Programa de fidelidade

- Cliente precisa estar autenticado para acumular pontos.
- Pontos são lançados uma única vez quando o pedido muda para **Concluído**.
- Regra inicial: 1 ponto por R$ 1,00 do subtotal dos itens após desconto. Taxa de entrega não gera pontos.
- 100 pontos podem ser trocados por um cupom pessoal de R$ 10,00.
- O cupom de resgate vale por 30 dias, uma utilização e somente na conta que o resgatou.
- O saldo é calculado pelo livro de lançamentos; resgates geram lançamentos negativos e não alteram pontos já conquistados.

## Cupons personalizados

- Cupons de reativação são vinculados ao ID da conta do cliente.
- Um cupom pessoal não pode ser validado ou usado por outra conta, mesmo que o código seja compartilhado.
- A ação administrativa em **Clientes e fidelidade** cria um cupom pessoal de 10%, uma utilização, com validade de 14 dias.
- Se o cliente autorizou ofertas e o Resend estiver configurado, a ação envia o cupom por e-mail. Sem o provedor, o código fica disponível para compartilhamento manual.

## Recuperação de clientes inativos

- Inatividade significa não ter pedido não cancelado nos últimos 30 dias; contas sem pedido também entram após 30 dias de criação.
- A rotina automática executa diariamente com cron às 15h UTC (12h em Brasília; no plano Hobby pode ocorrer dentro dessa hora) e processa até três clientes por execução.
- Só entram clientes com consentimento de marketing ativo.
- A rotina evita novo contato por 45 dias e não envia se houver cupom pessoal ativo.
- Cada campanha cria cupom pessoal de 10%, uma utilização, com validade de 14 dias.
- O e-mail inclui link assinado de descadastro. A preferência também pode ser alterada na conta do cliente.
- Clientes sem consentimento aparecem na lista administrativa, mas não recebem campanha nem cupom enviado por e-mail.

## Configuração de produção

Configure nas variáveis/segredos da Vercel:

- `CRON_SECRET`: segredo usado para autenticar as rotinas agendadas.
- `RESEND_API_KEY`: chave da API Resend.
- `RESEND_FROM_EMAIL`: remetente verificado no Resend.
- `MENUZA_PUBLIC_URL`: URL pública do cardápio, por exemplo `https://menuza-five.vercel.app` (opcional; existe fallback).

A campanha de clientes inativos roda pelo Vercel Cron semanal declarado em `vercel.json`. Os lembretes de carrinho abandonado continuam a cada 15 minutos por GitHub Actions em `.github/workflows/abandoned-cart-reminders.yml`, evitando exigir cron subdiário do plano Vercel Hobby. Configure também o secret `CRON_SECRET` no GitHub Actions com o mesmo valor definido na Vercel e, opcionalmente, a variável `MENUZA_PUBLIC_URL` no GitHub. O ambiente local SQLite não executa cron de e-mail; nele, a tela de clientes permite gerar o cupom pessoal e compartilhar o código manualmente.

## Indicadores

A tela **Vendas** mantém faturamento, pedidos, ticket médio, cancelamentos e taxa de retorno, e apresenta a contribuição estimada por produto com custo unitário cadastrado. A classificação de rentabilidade usa o custo direto unitário atual e deve ser interpretada como estimativa: não faz rateio de descontos, entrega, despesas fixas ou taxas de pagamento.

## Privacidade

- O consentimento de marketing é opcional, desmarcado por padrão e pode ser retirado a qualquer momento.
- A recuperação automática e o envio manual por e-mail exigem consentimento ativo.
- Ao excluir a conta, os lançamentos de fidelidade e campanhas associados são removidos e cupons pessoais pendentes são desativados.
- O texto da Política de Privacidade foi atualizado; ainda deve passar por revisão jurídica do controlador do estabelecimento antes da operação comercial.
