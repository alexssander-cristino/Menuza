# Menuza Mobile (Flutter)

O aplicativo usa Flutter com uma WebView para abrir o sistema web original do Menuza. Assim, o cardápio, o construtor de pratos, a sacola, o checkout, o painel e a experiência 3D continuam usando a implementação web existente.

## O que o app oferece

- Tela de conexão clara quando o servidor está indisponível.
- Botão de reconexão e indicador de carregamento.
- Endereço do servidor editável e salvo no aparelho para os próximos usos.
- Navegação de voltar do Android dentro do site.
- JavaScript habilitado para manter as funções interativas do sistema web.
- Ícone Android personalizável com uma imagem sua.
- Build de APK pelo GitHub Actions.

## Colocar a imagem do ícone

1. Escolha uma imagem quadrada em PNG, de preferência 1024 × 1024 pixels.
2. Copie a imagem para **`mobile_flutter/assets/app_icon.png`**. Crie a pasta `assets` se ainda não existir.
3. Envie as alterações ao GitHub.
4. O workflow **Build Menuza Flutter APK** detecta a imagem, gera os ícones Android e monta o APK automaticamente.

O arquivo deve se chamar exatamente `app_icon.png`. Deixe margem ao redor do símbolo, porque o Android pode recortar ícones adaptáveis em formatos diferentes. Use uma imagem que você tenha direito de usar.

## Testar no celular

1. No computador, execute `npm start` na raiz do repositório.
2. Descubra o IPv4 atual do computador com `ipconfig`.
3. Conecte celular e computador à mesma rede Wi-Fi.
4. Instale o APK e abra o Menuza. Se o endereço padrão não funcionar, use **Alterar endereço do servidor** na tela de conexão.

Exemplo de endereço local: `http://192.168.0.105:4173`.

**Importante:** o app móvel é o cliente; o servidor Node.js e o banco SQLite continuam no computador. Para funcionar fora da rede local ou quando o computador estiver desligado, será necessário hospedar o backend em um servidor acessível pela internet. O aplicativo não empacota o backend nem o banco.

## Gerar APK localmente

Na pasta `mobile_flutter`, com Flutter SDK e Android SDK instalados:

```powershell
flutter create --platforms=android --project-name menuza_mobile --org br.com.menuza .
flutter pub get
if (Test-Path .\assets\app_icon.png) { dart run flutter_launcher_icons }
flutter build apk --release
```

APK de release: `build/app/outputs/flutter-apk/app-release.apk`.

## Sobre a experiência 3D

O visualizador 3D existente é executado na WebView. O suporte a WebXR/realidade aumentada depende do Android, do aparelho e da versão da WebView; não pode ser garantido para todos os dispositivos.
