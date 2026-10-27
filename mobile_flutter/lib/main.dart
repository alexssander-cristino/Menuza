import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _defaultUrl = 'http://192.168.0.105:4173';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const MenuzaApp());
}

class MenuzaApp extends StatelessWidget {
  const MenuzaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Menuza',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Color(0xFF6D4CF5)),
      home: MenuzaWebScreen(),
    );
  }
}

class MenuzaWebScreen extends StatefulWidget {
  const MenuzaWebScreen({super.key});

  @override
  State<MenuzaWebScreen> createState() => _MenuzaWebScreenState();
}

class _MenuzaWebScreenState extends State<MenuzaWebScreen> {
  late final WebViewController _controller;
  final _urlController = TextEditingController(text: _defaultUrl);
  String _serverUrl = _defaultUrl;
  int _progress = 0;
  bool _loading = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF6F5F9))
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() {
              _progress = progress;
              _loading = progress < 100;
            });
          },
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _loading = true;
              _loadError = null;
              _progress = 0;
            });
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() {
              _loading = false;
              _progress = 100;
              _loadError = null;
            });
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame != true || !mounted) return;
            setState(() {
              _loading = false;
              _loadError = 'Não foi possível conectar ao Menuza. Confira se o servidor está ligado e se o celular está na mesma rede Wi-Fi do computador.';
            });
          },
        ),
      )
      ..loadRequest(Uri.parse(_serverUrl));
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<bool> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  Future<void> _changeServer() async {
    _urlController.text = _serverUrl;
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Endereço do Menuza'),
        content: TextField(
          controller: _urlController,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            hintText: 'http://192.168.0.105:4173',
            helperText: 'Use o IP do computador e a porta 4173.',
          ),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, _urlController.text.trim()), child: const Text('Conectar')),
        ],
      ),
    );

    if (result == null || result.isEmpty || !mounted) return;
    var value = result;
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      value = 'http://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Endereço inválido.')));
      return;
    }
    setState(() {
      _serverUrl = value;
      _loadError = null;
      _loading = true;
      _progress = 0;
    });
    await _controller.loadRequest(uri);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (!didPop && !await _handleBack() && mounted) return;
        if (!didPop && mounted) SystemNavigator.pop();
      },
      child: Scaffold(
        body: Stack(
          children: [
            Positioned.fill(child: WebViewWidget(controller: _controller)),
            if (_loading && _loadError == null)
              Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(
                value: _progress == 0 ? null : _progress / 100,
                minHeight: 2,
                backgroundColor: Colors.transparent,
                color: const Color(0xFF6D4CF5),
              )),
            if (_loadError != null)
              Positioned.fill(
                child: ColoredBox(
                  color: const Color(0xFFF6F5F9),
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.wifi_off_rounded, size: 52, color: Color(0xFF6D4CF5)),
                            const SizedBox(height: 18),
                            const Text('Não foi possível abrir o Menuza', textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF1B1530))),
                            const SizedBox(height: 10),
                            Text(_loadError!, textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 15, height: 1.5, color: Color(0xFF736F82))),
                            const SizedBox(height: 10),
                            Text(_serverUrl, textAlign: TextAlign.center,
                              style: const TextStyle(fontSize: 13, color: Color(0xFF736F82))),
                            const SizedBox(height: 22),
                            SizedBox(width: double.infinity, child: FilledButton.icon(
                              onPressed: () => _controller.loadRequest(Uri.parse(_serverUrl)),
                              icon: const Icon(Icons.refresh),
                              label: const Text('Tentar novamente'),
                            )),
                            TextButton(onPressed: _changeServer, child: const Text('Alterar endereço do servidor')),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
