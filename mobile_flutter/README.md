# Menuza para Flutter

O aplicativo Android é feito em Flutter e abre a interface original do Menuza em uma WebView. Essa abordagem mantém o mesmo HTML, CSS, animações, cardápio, construtor de pratos, sacola, checkout, painel e visualizador 3D do sistema web, em vez de recriar a interface e introduzir diferenças visuais.

## Testar no celular

1. No computador, execute `npm start` na raiz do repositório.
2. Confirme que o servidor está acessível em `http://192.168.0.105:4173`. Se o IP mudar, descubra o IPv4 com `ipconfig`.
3. Conecte celular e computador à mesma rede Wi-Fi.
4. Instale o APK de debug e abra o Menuza. Se necessário, use “Alterar endereço do servidor” na tela de erro.

O servidor Node.js e o banco SQLite continuam rodando no computador. O aplicativo Flutter é o cliente móvel; ele não empacota o servidor nem o banco.

## Gerar APK localmente

Com Flutter SDK e Android SDK instalados:

```powershell
cd mobile_flutter
flutter create --platforms=android --project-name menuza_mobile --org br.com.menuza .
flutter pub get
flutter build apk --debug
```

APK: `build/app/outputs/flutter-apk/app-debug.apk`.

## Limitações

O visualizador 3D existente é executado no navegador/WebView. A compatibilidade de WebXR/realidade aumentada depende da versão do Android, do dispositivo e do suporte da WebView; não é garantida.