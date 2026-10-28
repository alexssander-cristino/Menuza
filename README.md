# Bela Mesa — cardápio digital interativo

Aplicação local de demonstração para um restaurante: cardápio responsivo, composição de pizzas e hambúrgueres por camadas, sacola, checkout, pedidos persistidos, acompanhamento do cliente e painel de cozinha com atualização por Server-Sent Events.

## Executar localmente

Requisitos: Node.js 22.5 ou superior. A persistência usa o módulo SQLite incluído no Node. Não são necessárias dependências npm.

    cd outputs/mesa-studio
    npm start

Acesse http://localhost:4173. O arquivo data/mesa.sqlite é criado na primeira execução. Para desenvolvimento com reinício automático, use npm run dev.

O painel fica em Área do restaurante. A senha inicial da demonstração é mesa-demo.

## Menuza — identidade e arte dos alimentos

- A marca da plataforma é Menuza; Bela Mesa é o restaurante de demonstração.
- Tokens de design (cores, tipografia, espaçamento, raios, sombras, movimento) ficam no início de public/styles.css, com prefixo --mz-.
- public/food-art.js gera as ilustrações de pizza, hambúrguer e batatas a partir da composição escolhida. Elas são procedurais, não fotografias.
- O construtor alterna entre Ilustração e 3D. O botão Ver na minha mesa verifica WebXR e, sem suporte, mostra a prévia 3D.
- As fontes Inter e Bricolage Grotesque estão declaradas, mas não incluídas: sem os arquivos, o navegador usa a fonte do sistema.

## Configuração

- PORT: porta HTTP (padrão 4173).
- DATA_FILE: caminho do banco SQLite (padrão data/mesa.sqlite).
- ADMIN_PASSWORD: senha do painel. Em desenvolvimento, o padrão é mesa-demo.
- APP_SECRET: chave aleatória forte para assinar sessões. Em produção, ADMIN_PASSWORD e APP_SECRET são obrigatórias.
- NODE_ENV=production: ativa o cookie Secure, HSTS e impede inicialização sem as duas credenciais.

**Antes de publicar:** defina uma senha administrativa longa e exclusiva, gere APP_SECRET com um gerador criptograficamente seguro, use HTTPS e configure um volume persistente e backups protegidos para DATA_FILE. Nunca use a senha de demonstração em um serviço acessível pela internet. Os limites de segurança são registrados no SQLite, com janelas deslizantes, limites por IP/identidade e limpeza automática de eventos antigos. Para múltiplas instâncias, use armazenamento compartilhado e um WAF/limite na borda; não exponha o servidor sem proteção.

Exemplo PowerShell para desenvolvimento:

    $env:ADMIN_PASSWORD = "uma-senha-local"
    $env:APP_SECRET = "uma-chave-aleatoria-longa"
    npm start

## O que funciona

- Busca, categorias, filtro vegetariano e ordenação.
- Pizza: quatro tamanhos, três massas/bordas, ingredientes independentes e preço atualizado por escolha.
- Hambúrguer: tamanhos clássico e duplo, camadas de pão, carne, queijo, vegetais e adicionais.
- Composição estruturada no navegador e no pedido. Editar um item recupera as escolhas salvas.
- Prévia WebGL com giro e zoom; as opções selecionadas alimentam a geometria 3D e o pedido.
- Sacola salva localmente no navegador, edição de quantidades e checkout para retirada, mesa ou entrega.
- API recalcula preços, valida produtos e ingredientes ativos e mantém snapshots dos valores e nomes no momento da compra.
- SQLite com chaves estrangeiras, migração inicial e histórico de estados.
- Chave de idempotência no checkout, autenticação do painel por cookie assinado, limitação de tentativas de login, validação de origem, cabeçalhos HTTP de segurança e isolamento das consultas pelo identificador do restaurante de demonstração.
- Painel para acompanhar pedidos, atualizar estados, criar produtos, editar preço-base e disponibilidade, e editar preços/disponibilidade de adicionais.
- Pedidos aparecem no painel por Server-Sent Events. A página do cliente atualiza o acompanhamento a cada cinco segundos.
- Estados Pronto e Concluído só aparecem após mudança do restaurante no painel. Não existe aprovação de pagamento simulada.

## API principal

- GET /api/catalog — catálogo público ativo e opções de montagem.
- POST /api/orders — cria o pedido; recebe cliente, modalidade, composição e chave de idempotência.
- GET /api/tracking/:token — consulta o pedido com token aleatório de acompanhamento.
- POST /api/admin/login, POST /api/admin/logout, GET /api/admin/me — sessão do painel.
- GET /api/admin/dashboard, GET /api/admin/orders, GET /api/admin/events — operação e eventos.
- PATCH /api/admin/orders/:id — atualiza status seguindo transições permitidas.
- GET /api/admin/catalog, POST /api/admin/products, PATCH /api/admin/products/:id, PATCH /api/admin/ingredients/:id — gestão simplificada do cardápio.

## Testes

    npm test

A suíte usa node:test e inicia uma instância temporária com outro SQLite. Cobre preços e remoção independente de ingredientes, validação de composição, geometria 3D em função de tamanho e composição, autorização, prevenção de pedido duplicado, fluxo de status e recuperação após reiniciar o servidor.

## Visualizador 3D e realidade aumentada

- A janela de personalização usa WebGL para montar geometrias 3D procedurais de pizza, hambúrguer e batatas. Coberturas, porções, tamanho da pizza e versão dupla do hambúrguer alteram o modelo.
- As dimensões cadastradas em width_cm, depth_cm e height_cm alimentam o tamanho do modelo. Os diâmetros de pizza seguem a opção escolhida. Confira e ajuste as medidas para cada produto antes de usar em um restaurante real.
- O botão “Ver em AR” solicita uma sessão WebXR immersive-ar com detecção de superfície por hit-test. O acesso à câmera só começa após o toque do cliente. O prato é ancorado na superfície detectada em escala proporcional às dimensões cadastradas.
- Navegadores sem WebXR/hit-test continuam com o modelo 3D interativo. Não há simulação de câmera ou sobreposição de vídeo como substituto de AR.
- Para abrir modelos exportados pelos visualizadores nativos, Scene Viewer requer um GLB e Quick Look requer USDZ em HTTPS. Esta demo não vem com esses arquivos nem tem upload/editor para eles; produtos sem esses assets usam o caminho WebXR quando disponível e a prévia 3D nos demais navegadores.

A geometria procedural é uma visualização 3D própria para composição e escala; não é uma digitalização fotográfica de cada receita. O catálogo e as dimensões seed são dados de demonstração.

Não há integração de pagamentos, cálculo de frete, impressão de cozinha, autenticação individual por funcionário, criação de categorias, upload de imagens/modelos ou infraestrutura multi-restaurante pronta para produção. O schema relaciona os registros ao restaurante, mas esta instalação é uma demonstração de um restaurante e usa uma senha compartilhada no painel. Configure políticas, backups, HTTPS, monitoramento, regras de entrega e credenciais reais antes de expor o serviço publicamente.

Os preços de tamanhos são incrementos relativos ao preço-base cadastrado; adicionais são calculados pelo backend. A entrega não cobra taxa porque não há área ou tabela de frete configurada.
## Deploy

A aplicação serve a interface e a API na mesma origem. Para deploy, use um serviço Node 22.5+, configure NODE_ENV=production, ADMIN_PASSWORD, APP_SECRET e um volume persistente para DATA_FILE, e coloque o serviço atrás de HTTPS. Planeje backup do arquivo SQLite e migração para Postgres/isolamento por tenant antes de atender vários restaurantes simultaneamente.

## Backup e recuperação do SQLite

Crie um snapshot consistente do banco (inclusive quando o SQLite usa WAL) e verifique a integridade do arquivo gerado:

    npm run backup

O backup fica em `backups/` por padrão. Configure `DATA_FILE` para indicar outro banco, `BACKUP_DIR` para escolher o destino e `BACKUP_KEEP` para controlar quantos snapshots gerenciados são mantidos (padrão 14, máximo 365). O script não cria um banco vazio quando a origem não existe, valida a origem antes de copiar e valida novamente o snapshot antes de aplicar a retenção. Arquivos que não seguem o padrão `menuza-*.sqlite` não são removidos pela política de retenção.

**Importante:** o backup fica na mesma máquina por padrão; copie-o também para um destino separado e protegido para se recuperar de falha ou perda do disco. Para restaurar, pare o servidor, preserve uma cópia do banco atual, verifique o backup com `node -e`/SQLite ou rode o script em uma cópia de teste, então substitua o arquivo indicado por `DATA_FILE` e reinicie o serviço. Nunca sobrescreva o banco enquanto o servidor estiver ativo.

## Reiniciar os dados da demonstração

O banco local guarda pedidos entre execuções. Para voltar ao catálogo inicial, pare o servidor e apague os arquivos mesa.sqlite, mesa.sqlite-shm e mesa.sqlite-wal dentro de data. Na próxima inicialização, o catálogo de demonstração é criado novamente.


## Visualizador 3D (WebGL, sem dependências)

O 3D dos alimentos é renderizado em WebGL puro (`public/food-scene.js`) a partir de modelos procedurais (`public/food-models.js`, `public/food-geo.js`). Nenhuma imagem estática é usada para simular a rotação.

- **Modelos**: hambúrguer (pão com gergelim, carne com marcas de chapa, queijo que escorre, alface em camadas, tomate, cebola, picles, bacon, ovo, molho), pizza (crosta tradicional, fina ou recheada, molho, queijo com cortes, 10 coberturas com forma própria, distribuição sem sobreposição) e batatas rústicas com aioli.
- **Peças em cache**: cada ingrediente é uma peça independente. Ao adicionar ou remover, só a peça afetada é construída; as demais apenas mudam de altura com animação. A câmera permanece onde o usuário a deixou.
- **Iluminação**: GGX + Fresnel, estúdio procedural, relevo procedural, translucidez, sombras suaves (WebGL2), tone mapping ACES, MSAA e resolução adaptativa.
- **Controles**: arrastar (mouse/toque) gira 360° e inclina; pinça ou roda dá zoom; duplo clique ou VISTA volta à posição inicial; AUTO liga/pausa a rotação; teclado: setas, `+`/`-`, `0`/Home, espaço.
- **Estabilidade**: carregamento incremental com indicador, mensagem de erro com fallback para a ilustração, recuperação de perda de contexto e liberação de buffers/texturas ao fechar.

Limitações conhecidas: sombras em tempo real exigem WebGL2 (em WebGL1 o modelo aparece sem sombra projetada); a oclusão de ambiente é calculada por vértice e pela sombra de contato, não por SSAO; a translucidez da alface é sombreamento, sem transparência real; a parte inferior do alimento não é visível porque ele está sobre uma tábua.


## Aplicativo Android em Flutter

O projeto móvel está em `mobile_flutter/`. Ele usa Flutter para o aplicativo Android e abre a interface web original do Menuza em uma WebView, preservando HTML, CSS, animações, carrinho, painel e visualizador 3D sem recriar o visual em widgets diferentes.

### Testar no celular

1. No computador, execute `npm start` na raiz do projeto.
2. Deixe o computador e o celular na mesma rede Wi-Fi.
3. Confirme o IP IPv4 do PC com `ipconfig`. O endereço padrão configurado no app é `http://192.168.0.105:4173`.
4. Abra o APK no Android. Se o IP mudar, a tela de conexão permite informar outro endereço.

O servidor Node.js e o SQLite continuam no computador; o APK não inclui o backend nem o banco.

### Gerar APK

O workflow [Build Menuza Flutter APK](https://github.com/alexssander-cristino/Menuza/actions/workflows/android-apk.yml) compila automaticamente quando arquivos de `mobile_flutter/` mudam. Acesse **Actions**, abra a execução mais recente e baixe o artefato `menuza-flutter-debug`.

Para compilar localmente, com Flutter e Android SDK instalados:

```powershell
cd mobile_flutter
flutter create --platforms=android --project-name menuza_mobile --org br.com.menuza .
flutter pub get
flutter build apk --debug
```

O APK será gerado em `mobile_flutter/build/app/outputs/flutter-apk/app-debug.apk`. O suporte a WebXR/realidade aumentada continua dependendo do dispositivo e da WebView e não é garantido.


### Acesso pelo celular na rede Wi-Fi (Windows)

O servidor já escuta em todas as interfaces de rede. Para permitir que o Android acesse a porta 4173, use o script incluído no repositório:

1. Abra o PowerShell **como administrador**.
2. Entre na pasta do projeto e atualize os arquivos: `git pull origin main` (resolva conflitos locais antes, se houver).
3. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\\scripts\\iniciar-menuza-mobile.ps1
```

O script cria uma regra de entrada no Firewall do Windows para TCP 4173 e inicia o servidor. Mantenha essa janela aberta. No celular conectado ao mesmo Wi-Fi, abra o endereço IP exibido pelo script, por exemplo `http://192.168.0.105:4173`. Se nem o navegador do celular abrir esse endereço, confira se a rede Wi-Fi permite comunicação entre dispositivos e se o PC está usando perfil de rede Privado. O APK não hospeda o servidor: o computador precisa continuar ligado e com o servidor executando.


## Segurança adicional

- Respostas HTTP 429 exibem uma página dedicada no navegador e incluem `Retry-After`.
- Limites deslizantes persistidos no SQLite para API, autenticação, cadastro, criação de pedidos e acompanhamento. Para pedidos, o limite padrão é 60 por IP a cada 10 minutos e 240 por IP por hora, para permitir estabelecimentos com cerca de 100 pedidos/hora e clientes compartilhando o mesmo Wi-Fi; ajuste após observar tráfego real.
- Honeypot nos formulários de login, cadastro e checkout para reduzir bots simples.
- Cabeçalhos de segurança, limite de tamanho do corpo, validação de origem e timeouts HTTP.
- `TRUST_PROXY=true` só deve ser ativado se o servidor estiver atrás de um proxy reverso confiável que sobrescreva `X-Forwarded-For`; caso contrário, o IP é obtido da conexão TCP.
- O Menuza não possui atualmente endpoints de LLM/IA. Se forem adicionados, aplique autenticação e cotas próprias, limite de tokens/tamanho, timeout, validação de saída e nunca exponha chaves de provedores no navegador. `robots.txt` e `llms.txt` são diretivas informativas, não mecanismos de controle de acesso.
