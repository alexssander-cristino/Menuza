
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _defaultUrl = 'http://192.168.0.105:4173';
const _purple = Color(0xFF6D4CF5);
const _background = Color(0xFFF6F5F9);
const _ink = Color(0xFF211B35);
const _muted = Color(0xFF736F82);

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
        foregroundColor: _ink,
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

class _MenuzaWebScreenState extends State<MenuzaWebScreen>
    with SingleTickerProviderStateMixin {
  late final WebViewController _controller;
  late final AnimationController _introController;
  late final Animation<double> _introOpacity;
  final TextEditingController _urlController = TextEditingController();

  String _serverUrl = _defaultUrl;
  int _progress = 0;
  bool _loading = true;
  bool _initializing = true;
  bool _openingSettings = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _introController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _introOpacity = CurvedAnimation(parent: _introController, curve: Curves.easeOutCubic);
    _introController.forward();

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(true)
      ..setNavigationDelegate(NavigationDelegate(
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
        onHttpError: (error) {
          if (!mounted || error.request?.uri.toString() != _serverUrl) return;
          setState(() {
            _loading = false;
            _loadError = 'O servidor respondeu com erro HTTP ' +
                (error.response?.statusCode?.toString() ?? '') + '.';
          });
        },
        onWebResourceError: (error) {
          if (error.isForMainFrame != true || !mounted) return;
          setState(() {
            _loading = false;
            _loadError = 'Não foi possível conectar ao servidor do Menuza.';
          });
        },
        onNavigationRequest: (request) {
          final uri = Uri.tryParse(request.url);
          if (uri == null) return NavigationDecision.prevent;
          if (['mailto', 'tel', 'sms', 'whatsapp'].contains(uri.scheme)) {
            _openExternal(uri);
            return NavigationDecision.prevent;
          }
          if (uri.scheme != 'http' && uri.scheme != 'https') {
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ));
    _initialize();
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não há aplicativo disponível para abrir este link.')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Não foi possível abrir o link neste aparelho.')),
        );
      }
    }
  }

  Future<void> _initialize() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString('menuza_server_url');
      if (saved != null && _validUrl(_normalizeUrl(saved))) {
        _serverUrl = _normalizeUrl(saved);
      }
    } catch (_) {
      // Preferências indisponíveis não devem bloquear a inicialização.
    }
    if (!mounted) return;
    setState(() => _initializing = false);
    await _loadServer(_serverUrl);
  }

  bool _validUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    return uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty;
  }

  String _normalizeUrl(String value) {
    var normalized = value.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'http://' + normalized;
    }
    final uri = Uri.tryParse(normalized);
    if (uri == null) return normalized;
    return uri.replace(path: uri.path == '/' ? '' : uri.path, fragment: '').toString();
  }

  Future<void> _loadServer(String value) async {
    final normalized = _normalizeUrl(value);
    if (!_validUrl(normalized) || !mounted) return;
    setState(() {
      _serverUrl = normalized;
      _loadError = null;
      _loading = true;
      _progress = 0;
    });
    try {
      await _controller.loadRequest(Uri.parse(normalized));
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('menuza_server_url', normalized);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = 'Não foi possível iniciar a conexão. Confira o endereço e tente novamente.';
      });
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _introController.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    if (_initializing) return;
    setState(() {
      _loadError = null;
      _loading = true;
      _progress = 0;
    });
    try {
      await _controller.reload();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadError = 'Falha ao recarregar. Confira a conexão e tente novamente.';
      });
    }
  }

  Future<bool> _handleBack() async {
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  Future<void> _changeServer() async {
    if (_openingSettings) return;
    _openingSettings = true;
    _urlController.text = _serverUrl;
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Conectar ao Menuza'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Informe o endereço do sistema. Você pode alternar entre o servidor local e um endereço publicado na internet.'),
            const SizedBox(height: 16),
            TextField(
              controller: _urlController,
              autofocus: true,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.done,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: 'URL do servidor',
                hintText: 'https://seu-dominio.com',
                helperText: 'Local: http://IP-DO-PC:4173',
                border: OutlineInputBorder(),
              ),
              onSubmitted: (value) => Navigator.pop(dialogContext, value.trim()),
            ),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              OutlinedButton(
                onPressed: () => _urlController.text = _defaultUrl,
                child: const Text('Exemplo local'),
              ),
              OutlinedButton(
                onPressed: () => _urlController.text = 'https://',
                child: const Text('Usar HTTPS'),
              ),
            ]),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, _urlController.text.trim()), child: const Text('Conectar')),
        ],
      ),
    );
    _openingSettings = false;
    if (result == null || result.trim().isEmpty || !mounted) return;
    final value = _normalizeUrl(result);
    if (!_validUrl(value)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Endereço inválido. Use uma URL HTTP ou HTTPS válida.')),
      );
      return;
    }
    await _loadServer(value);
  }

  Future<void> _showConnectionHelp() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 28),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Como conectar', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: _ink)),
              const SizedBox(height: 14),
              _helpRow(Icons.wifi_rounded, 'Rede local', 'Execute npm start no computador, conecte celular e PC ao mesmo Wi-Fi e informe http://IP-DO-PC:4173. O IP aparece no comando ipconfig.'),
              const SizedBox(height: 12),
              _helpRow(Icons.language_rounded, 'Acesso pela internet', 'Informe a URL HTTPS de um Menuza hospedado publicamente. O backend Node.js e o banco SQLite também precisam estar hospedados e acessíveis.'),
              const SizedBox(height: 12),
              _helpRow(Icons.power_settings_new_rounded, 'Servidor ligado', 'No modo local, o computador precisa continuar ligado e o firewall deve permitir a porta 4173.'),
              const SizedBox(height: 16),
              SelectableText(_serverUrl, style: const TextStyle(color: _purple, fontWeight: FontWeight.w700)),
              const SizedBox(height: 18),
              SizedBox(width: double.infinity, child: FilledButton.icon(
                onPressed: () {
                  Navigator.pop(sheetContext);
                  _changeServer();
                },
                icon: const Icon(Icons.settings_ethernet_rounded),
                label: const Text('Alterar endereço'),
              )),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _helpRow(IconData icon, String title, String description) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(color: _purple.withValues(alpha: .10), borderRadius: BorderRadius.circular(13)),
        child: Icon(icon, color: _purple),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w700, color: _ink)),
        const SizedBox(height: 4),
        Text(description, style: const TextStyle(height: 1.45, color: _muted)),
      ])),
    ],
  );

  Widget _buildIntro() => FadeTransition(
    opacity: _introOpacity,
    child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
      Container(
        width: 86,
        height: 86,
        decoration: BoxDecoration(
          color: _purple,
          borderRadius: BorderRadius.circular(27),
          boxShadow: [BoxShadow(color: _purple.withValues(alpha: .22), blurRadius: 28, offset: const Offset(0, 12))],
        ),
        child: const Icon(Icons.restaurant_menu_rounded, color: Colors.white, size: 43),
      ),
      const SizedBox(height: 18),
      const Text('Menuza', style: TextStyle(fontSize: 27, fontWeight: FontWeight.w800, color: _ink, letterSpacing: -.6)),
      const SizedBox(height: 6),
      const Text('Seu cardápio, do seu jeito.', style: TextStyle(color: _muted)),
      const SizedBox(height: 24),
      const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5, color: _purple)),
    ])),
  );

  Widget _buildConnectionError() => ColoredBox(
    color: _background,
    child: Center(child: SingleChildScrollView(
      padding: const EdgeInsets.all(26),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(color: _purple.withValues(alpha: .10), borderRadius: BorderRadius.circular(26)),
            child: const Icon(Icons.wifi_off_rounded, size: 42, color: _purple),
          ),
          const SizedBox(height: 22),
          const Text('Vamos conectar ao Menuza', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: _ink)),
          const SizedBox(height: 10),
          Text(_loadError ?? 'Confira a conexão com o servidor.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, height: 1.5, color: _muted)),
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE8E4F0))),
            child: SelectableText(_serverUrl, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: Color(0xFF5C43D6))),
          ),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity, height: 50, child: FilledButton.icon(onPressed: _reload, icon: const Icon(Icons.refresh_rounded), label: const Text('Tentar novamente'))),
          const SizedBox(height: 8),
          SizedBox(width: double.infinity, height: 48, child: OutlinedButton.icon(onPressed: _changeServer, icon: const Icon(Icons.settings_ethernet_rounded), label: const Text('Alterar endereço do servidor'))),
          TextButton(onPressed: _showConnectionHelp, child: const Text('Preciso de ajuda para conectar')),
        ]),
      ),
    )),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (didPop, result) async {
      if (didPop) return;
      if (await _handleBack()) SystemNavigator.pop();
    },
    child: Scaffold(
      body: SafeArea(top: false, bottom: false, child: Stack(children: [
        Positioned.fill(
          child: _initializing
              ? _buildIntro()
              : _loadError != null
                  ? _buildConnectionError()
                  : WebViewWidget(controller: _controller),
        ),
        if (_loading && _loadError == null && !_initializing)
          Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(
            value: _progress == 0 ? null : _progress / 100,
            minHeight: 2,
            backgroundColor: Colors.transparent,
            color: _purple,
          )),
      ])),
    ),
  );
}
