# Menuza Mobile (Flutter)

O Menuza Mobile usa Flutter + WebView para manter o sistema web original, incluindo cardápio, construtor 3D, sacola, checkout e painel, sem duplicar essas funcionalidades em código nativo.

## Melhorias incluídas

- Tela de abertura com identidade Menuza e animação discreta.
- Indicador de carregamento e erros HTTP/de rede com opção de tentar novamente.
- Endereço HTTP/HTTPS configurável e salvo no aparelho.
- Alternância manual entre servidor local e servidor hospedado.
- Navegação de voltar do Android e abertura externa de links de telefone, SMS, e-mail e WhatsApp.
- Validação básica da URL antes de conectar.
- Workflow automatizado que analisa o Dart, executa os testes e compila um APK para instalação.

## Servidor local (mesmo Wi-Fi)

1. No computador, entre na pasta raiz do projeto e execute `npm start`.
2. Descubra o IPv4 do computador com `ipconfig`.
3. Conecte o computador e o celular à mesma rede Wi-Fi.
4. No Menuza Mobile, use **Alterar endereço do servidor** e informe `http://IP-DO-PC:4173`, por exemplo `http://192.168.0.105:4173`.
5. Se não conectar, confirme que o servidor está ativo e que o Firewall do Windows permite conexões de entrada na porta 4173.

O IP pode mudar quando o roteador renova a conexão. Atualize o endereço no app se isso acontecer.

## Acesso pela internet

1. Hospede o servidor Node.js e o banco SQLite em um serviço que mantenha o processo e os dados persistentes.
2. Configure domínio e HTTPS para o sistema hospedado.
3. No app, informe a URL pública completa, por exemplo `https://menuza.seudominio.com`.

**Importante:** configurar uma URL no aplicativo não publica o servidor automaticamente. O app não contém o backend nem o banco. O acesso remoto só funciona depois de hospedar o sistema e garantir armazenamento persistente para o SQLite; não use armazenamento efêmero para pedidos.

## Ícone do aplicativo

Coloque um PNG quadrado seu em `mobile_flutter/assets/app_icon.png` (idealmente 1024 × 1024) e envie ao GitHub. O workflow gera o ícone Android automaticamente. Se esse arquivo não existir, será usado o ícone padrão do projeto Flutter.

## Gerar e testar APK localmente

Na pasta `mobile_flutter`, com Flutter SDK e Android SDK instalados:

```powershell
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

APK de teste: `build/app/outputs/flutter-apk/app-debug.apk`.

O GitHub Actions também executa análise, testes e build a cada alteração nos arquivos de `mobile_flutter`. Baixe o artefato `menuza-flutter-debug` na execução concluída em https://github.com/alexssander-cristino/Menuza/actions.

## Limites da WebView

O app mantém as funcionalidades web existentes, mas câmera, seletor de arquivos, reprodução em tela cheia e realidade aumentada dependem da implementação web e do suporte do Android WebView. O build automatizado não substitui um teste físico de checkout, pedidos, câmera e visualizador 3D em um aparelho real.
