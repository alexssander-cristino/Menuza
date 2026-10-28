import 'package:flutter_test/flutter_test.dart';
import 'package:menuza_mobile/server_address.dart';

void main() {
  group('normalizeServerUrl', () {
    test('adds http scheme to local addresses', () {
      expect(normalizeServerUrl('192.168.0.20:4173'), 'http://192.168.0.20:4173');
    });

    test('preserves HTTPS addresses and removes root slash and fragment', () {
      expect(
        normalizeServerUrl('https://menuza.example/#!/menu'),
        'https://menuza.example/',
      );
    });

    test('trims surrounding whitespace', () {
      expect(normalizeServerUrl('  http://localhost:4173  '), 'http://localhost:4173');
    });
  });

  group('isValidServerUrl', () {
    test('accepts local HTTP and hosted HTTPS URLs', () {
      expect(isValidServerUrl('http://192.168.0.20:4173'), isTrue);
      expect(isValidServerUrl('https://menuza.example'), isTrue);
    });

    test('rejects missing host, unsupported schemes, and credentials', () {
      expect(isValidServerUrl('https://'), isFalse);
      expect(isValidServerUrl('file:///tmp/menuza'), isFalse);
      expect(isValidServerUrl('https://user:pass@menuza.example'), isFalse);
    });
  });
}
