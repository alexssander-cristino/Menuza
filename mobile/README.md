# Menuza Android

Este aplicativo Android abre a interface web existente do Menuza em uma WebView, mantendo o backend Node/SQLite no computador durante os testes. O endereço do servidor é editável na primeira tela.

## Gerar APK

O workflow **Build Menuza Android APK** é executado ao enviar alterações na pasta mobile ou manualmente em GitHub > Actions > Build Menuza Android APK > Run workflow. Baixe o artefato menuza-android-debug e extraia o app-debug.apk.

## Testar no celular pela rede local

1. No computador, execute npm start na raiz do projeto.
2. Execute ipconfig e anote o endereço IPv4 da placa conectada ao Wi-Fi.
3. Confirme que o servidor escuta conexões externas. Se necessário, ajuste o servidor para usar 0.0.0.0 em vez de apenas localhost.
4. No celular e no computador, conecte-se à mesma rede Wi-Fi.
5. Abra o APK, informe http://IP-DO-PC:4173 e toque em Abrir Menuza.
6. Se não conectar, permita Node.js no Firewall do Windows e confira se o servidor está acessível pelo navegador do celular.

O APK não inclui o servidor nem o banco SQLite: o computador precisa permanecer ligado e executando npm start. Para acesso fora da rede local, publique o servidor em HTTPS e use esse endereço.

## Limitações

O aplicativo habilita JavaScript, armazenamento local, cookies e solicitação de permissão da câmera para recursos web. O suporte a WebXR/AR imersiva depende do dispositivo, da versão do Android System WebView e do contexto HTTPS; a WebView do APK não garante suporte a WebXR. A prévia 3D comum continua dependente do suporte WebGL do aparelho.
