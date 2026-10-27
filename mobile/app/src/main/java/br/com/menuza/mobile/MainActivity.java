package br.com.menuza.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private WebView webView;
    private static final int CAMERA_REQUEST = 41;
    private PermissionRequest pendingPermissionRequest;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON, WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        CookieManager.getInstance().setAcceptCookie(true);
        showConnectScreen();
    }

    private void showConnectScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(42), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(18, 18, 24));
        TextView title = new TextView(this);
        title.setText("Menuza"); title.setTextColor(Color.WHITE); title.setTextSize(32); title.setTypeface(null, 1);
        root.addView(title);
        TextView subtitle = new TextView(this);
        subtitle.setText("Conecte o aplicativo ao servidor que está rodando no computador. Celular e PC precisam estar na mesma rede Wi-Fi.");
        subtitle.setTextColor(Color.rgb(205, 205, 218)); subtitle.setTextSize(15);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, -2); sp.topMargin = dp(12); root.addView(subtitle, sp);
        EditText address = new EditText(this);
        address.setSingleLine(true); address.setTextColor(Color.WHITE); address.setHintTextColor(Color.GRAY);
        address.setHint("http://IP-DO-PC:4173");
        address.setText(getPreferences(0).getString("server_url", "http://192.168.0.106:4173"));
        address.setSelectAllOnFocus(true); address.setInputType(17);
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-1, dp(56)); ap.topMargin = dp(24); root.addView(address, ap);
        Button connect = new Button(this); connect.setText("Abrir Menuza");
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, dp(54)); cp.topMargin = dp(12); root.addView(connect, cp);
        connect.setOnClickListener(v -> {
            String url = address.getText().toString().trim();
            if (url.isEmpty()) { address.setError("Informe o endereço do servidor"); return; }
            if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
            if (Uri.parse(url).getHost() == null) { address.setError("Endereço inválido"); return; }
            getPreferences(0).edit().putString("server_url", url).apply(); openSite(url);
        });
        TextView help = new TextView(this);
        help.setText("No PC, execute npm start. Descubra o IP com ipconfig e use http://SEU-IP:4173. Se não conectar, permita Node.js no Firewall do Windows.");
        help.setTextColor(Color.rgb(155, 155, 172)); help.setTextSize(13);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, -2); hp.topMargin = dp(22); root.addView(help, hp);
        setContentView(root);
    }

    private void openSite(String url) {
        webView = new WebView(this); webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true); settings.setMediaPlaybackRequiresUserGesture(false); settings.setLoadsImagesAutomatically(true);
        settings.setSupportZoom(false); settings.setBuiltInZoomControls(false); settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme(); return !("http".equals(scheme) || "https".equals(scheme));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean asksCamera = false;
                    for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) asksCamera = true;
                    if (asksCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        pendingPermissionRequest = request; requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
                    } else request.grant(request.getResources());
                });
            }
        });
        setContentView(webView); webView.loadUrl(url);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_REQUEST && pendingPermissionRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            else { pendingPermissionRequest.deny(); Toast.makeText(this, "Permissão da câmera negada", Toast.LENGTH_SHORT).show(); }
            pendingPermissionRequest = null;
        }
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else if (webView != null) showConnectScreen(); else super.onBackPressed();
    }
    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }
}
