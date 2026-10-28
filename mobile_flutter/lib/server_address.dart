String normalizeServerUrl(String value) {
  var normalized = value.trim();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'http://' + normalized;
  }
  final uri = Uri.tryParse(normalized);
  if (uri == null) return normalized;
  return uri.replace(path: uri.path == '/' ? '' : uri.path, fragment: '').toString();
}

bool isValidServerUrl(String value) {
  final uri = Uri.tryParse(value.trim());
  return uri != null &&
      (uri.scheme == 'http' || uri.scheme == 'https') &&
      uri.host.isNotEmpty &&
      uri.userInfo.isEmpty;
}
