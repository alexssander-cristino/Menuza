import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _defaultUrl = 'http://192.168.0.105:4173';
const _purple = Color(0xFF6D4CF5);
const _background = Color(0xFFF6F5F9);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    systemNavigationBarColor: _background,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  runApp(const MenuzaApp());
}

class MenuzaApp extends StatelessWidget {
  const MenuzaApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Menuza',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: _purple),
          scaffoldBackgroundColor: _background,
          appBarTheme: const AppBarTheme(
            backgroundColor: _background,
            foregroundColor: Color(0xFF211B35),
            surfaceTintColor: Colors.transparent,
          ),
        ),
        home: const MenuzaWebScreen(),
      );
}

class MenuzaWebScreen extends StatefulWidget {
  const MenuzaWebScreen({super.key});

  @override
  State<MenuzaWebScreen> createState() => _MenuzaWebScreenState();
}

class _MenuzaWebScreenState extends State<MenuzaWebScreen> {
  late final WebViewController _controller;
  final TextEditingController _urlController = TextEditingController();
  String _serverUrl = _defaultUrl;
  int _progress = 0;
  bool _loading = true;
  bool _initializing = true;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(true)
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
              _loadError = 'Não foi possível conectar ao servidor do Menuza.';
            });
          },
        ),
      );
    _initialize();
  }

  Future<void> _initialize() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('menuza_server_url');
    if (saved != null && _validUrl(saved)) _serverUrl = saved;
    if (!mounted) return;
    setState(() => _initializing = false);
    await _controller.loadRequest(Uri.parse(_serverUrl));
  }

  bool _validUrl(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    if (_initializing) return;
    setState(() {
      _loadError = null;
      _loading = true;
      _progress = 0;
    });
    await _controller.reload();
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
      builder: (dialogContext) => AlertDialog(
        title: const Text('Conectar ao Menuza'),
        content: TextField(
          controller: _urlController,
          autofocus: true,
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(
            labelText: 'Endereço do servidor',
            hintText: 'http://192.168.0.105:4173',
            helperText: 'Use o IP do computador e a porta 4173.',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(dialogContext, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, _urlController.text.trim()),
            child: const Text('Conectar'),
          ),
        ],
      ),
    );

    if (result == null || result.trim().isEmpty || !mounted) return;
    var value = result.trim();
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      value = 'http://$value';
    }
    if (!_validUrl(value)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Endereço inválido. Informe uma URL HTTP ou HTTPS.')),
      );
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('menuza_server_url', value);
    if (!mounted) return;
    setState(() {
      _serverUrl = value;
      _loadError = null;
      _loading = true;
      _progress = 0;
    });
    await _controller.loadRequest(Uri.parse(value));
  }

  Future<void> _showConnectionHelp() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Como conectar', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              const Text('1. Ligue o servidor do Menuza no computador com npm start.'),
              const SizedBox(height: 8),
              const Text('2. Conecte o celular e o computador à mesma rede Wi-Fi.'),
              const SizedBox(height: 8),
              const Text('3. Abra o endereço abaixo no navegador do celular para testar a conexão.'),
              const SizedBox(height: 12),
              SelectableText(_serverUrl, style: const TextStyle(color: _purple, fontWeight: FontWeight.w600)),
              const SizedBox(height: 12),
              const Text('O computador precisa continuar ligado enquanto o app usa o servidor local.',
                  style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    _changeServer();
                  },
                  icon: const Icon(Icons.settings_ethernet),
                  label: const Text('Alterar endereço'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, result) async {
          if (didPop) return;
          if (await _handleBack()) SystemNavigator.pop();
        },
        child: Scaffold(
          body: SafeArea(
            top: false,
            bottom: false,
            child: Stack(
              children: [
                Positioned.fill(
                  child: _initializing
                      ? const Center(child: CircularProgressIndicator(color: _purple))
                      : WebViewWidget(controller: _controller),
                ),
                if (_loading && _loadError == null && !_initializing)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: LinearProgressIndicator(
                      value: _progress == 0 ? null : _progress / 100,
                      minHeight: 2,
                      backgroundColor: Colors.transparent,
                      color: _purple,
                    ),
                  ),
                if (_loadError != null)
                  Positioned.fill(
                    child: ColoredBox(
                      color: _background,
                      child: Center(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(26),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 420),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  width: 88,
                                  height: 88,
                                  decoration: BoxDecoration(
                                    color: _purple.withValues(alpha: .10),
                                    borderRadius: BorderRadius.circular(26),
                                  ),
                                  child: const Icon(Icons.restaurant_menu_rounded, size: 44, color: _purple),
                                ),
                                const SizedBox(height: 22),
                                const Text(
                                  'Vamos conectar ao Menuza',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Color(0xFF211B35)),
                                ),
                                const SizedBox(height: 10),
                                const Text(
                                  'Confira se o servidor está ligado e se o celular está na mesma rede Wi-Fi do computador.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 15, height: 1.5, color: Color(0xFF736F82)),
                                ),
                                const SizedBox(height: 12),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: const Color(0xFFE8E4F0)),
                                  ),
                                  child: SelectableText(
                                    _serverUrl,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(fontSize: 13, color: Color(0xFF5C43D6)),
                                  ),
                                ),
                                const SizedBox(height: 20),
                                SizedBox(
                                  width: double.infinity,
                                  height: 50,
                                  child: FilledButton.icon(
                                    onPressed: _reload,
                                    icon: const Icon(Icons.refresh_rounded),
                                    label: const Text('Tentar novamente'),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                SizedBox(
                                  width: double.infinity,
                                  height: 48,
                                  child: OutlinedButton.icon(
                                    onPressed: _changeServer,
                                    icon: const Icon(Icons.settings_ethernet_rounded),
                                    label: const Text('Alterar endereço do servidor'),
                                  ),
                                ),
                                TextButton(
                                  onPressed: _showConnectionHelp,
                                  child: const Text('Preciso de ajuda para conectar'),
                                ),
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
        ),
      );
}
