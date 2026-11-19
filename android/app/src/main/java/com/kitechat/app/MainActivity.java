package com.kitechat.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.app.NotificationCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private final ExecutorService httpExecutor = Executors.newFixedThreadPool(4);
    private volatile String lastInsets = "{\"top\":0,\"bottom\":0,\"ime\":0}";
    private final ConcurrentHashMap<String, HttpURLConnection> activeConns = new ConcurrentHashMap<>();
    private String pendingShare = null;
    private PermissionRequest pendingPermissionRequest = null;
    private boolean webReady = false;

    /** 文件名只取 basename，禁止路径分隔符，防目录穿越 */
    private static String safeFileName(String name) {
        String base = name.replace('\\', '/');
        int slash = base.lastIndexOf('/');
        if (slash >= 0) {
            base = base.substring(slash + 1);
        }
        base = base.replaceAll("[\\r\\n\\t]", "").trim();
        if (base.isEmpty() || base.equals(".") || base.equals("..")) {
            base = "kitechat-" + System.currentTimeMillis();
        }
        return base;
    }

    /** 原生桥：存储 / HTTP（可取消）/ 通知 / 分享 */
    public class NativeHttp {
        @JavascriptInterface
        public String saveImage(String base64, String mime, String name) {
            try {
                name = safeFileName(name);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, mime);
                if (Build.VERSION.SDK_INT >= 29) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/KiteChat");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                }
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    return "error";
                }
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) {
                    return "error";
                }
                os.write(bytes);
                os.close();
                if (Build.VERSION.SDK_INT >= 29) {
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                }
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String saveFile(String base64, String mime, String name) {
            try {
                name = safeFileName(name);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        return "error";
                    }
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) {
                        return "error";
                    }
                    os.write(bytes);
                    os.close();
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                } else {
                    java.io.File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!dir.exists()) {
                        dir.mkdirs();
                    }
                    java.io.File file = new java.io.File(dir, name);
                    OutputStream os = new java.io.FileOutputStream(file);
                    os.write(bytes);
                    os.close();
                }
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String getInsets() {
            return lastInsets;
        }

        @JavascriptInterface
        public void cancel(String id) {
            HttpURLConnection conn = activeConns.remove(id);
            if (conn != null) {
                conn.disconnect();
            }
        }

        @JavascriptInterface
        public void notify(String title, String body) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (Build.VERSION.SDK_INT >= 26) {
                    NotificationChannel channel = new NotificationChannel("kitechat_done", "KiteChat", NotificationManager.IMPORTANCE_DEFAULT);
                    nm.createNotificationChannel(channel);
                }
                NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, "kitechat_done")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setAutoCancel(true);
                nm.notify((int) System.currentTimeMillis(), builder.build());
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String takeShare() {
            String share = pendingShare;
            pendingShare = null;
            return share == null ? "" : share;
        }

        @JavascriptInterface
        public void setNativeTheme(final boolean dark) {
            // 持久化主题供下次冷启动读取，替代解析 WebView leveldb 的脆弱做法
            getSharedPreferences("kitechat", MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
            runOnUiThread(() -> {
                androidx.core.view.WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);
            });
        }

        @JavascriptInterface
        public void webReady() {
            webReady = true;
            if (pendingShare != null) {
                dispatchShare();
            }
        }

        @JavascriptInterface
        public void fetchAsync(final String requestJson, final String callbackName) {
            httpExecutor.execute(() -> {
                final String result = doFetch(requestJson);
                dispatchJs(callbackName, result);
            });
        }

        /** 分块流式通道：meta（状态/头）→ 多个 chunk（base64 字节）→ done，跨域回退时仍保持真流式 */
        @JavascriptInterface
        public void fetchStream(final String requestJson, final String callbackName) {
            httpExecutor.execute(() -> {
                String id = null;
                HttpURLConnection conn = null;
                try {
                    JSONObject req = new JSONObject(requestJson);
                    id = req.optString("id", null);
                    conn = openConnection(req, id);
                    int status = conn.getResponseCode();
                    JSONObject meta = new JSONObject();
                    meta.put("type", "meta");
                    meta.put("status", status);
                    JSONObject outHeaders = new JSONObject();
                    for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                        if (entry.getKey() != null && !entry.getValue().isEmpty()) {
                            outHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                        }
                    }
                    meta.put("headers", outHeaders);
                    dispatchJs(callbackName, meta.toString());
                    InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                    if (is != null) {
                        byte[] chunk = new byte[8192];
                        int n;
                        while ((n = is.read(chunk)) > 0) {
                            JSONObject part = new JSONObject();
                            part.put("type", "chunk");
                            part.put("data", Base64.encodeToString(java.util.Arrays.copyOf(chunk, n), Base64.NO_WRAP));
                            dispatchJs(callbackName, part.toString());
                        }
                        is.close();
                    }
                    dispatchJs(callbackName, "{\"type\":\"done\"}");
                } catch (Exception e) {
                    try {
                        JSONObject err = new JSONObject();
                        err.put("type", "error");
                        err.put("message", String.valueOf(e.getMessage()));
                        dispatchJs(callbackName, err.toString());
                    } catch (Exception ignored) {
                    }
                } finally {
                    if (id != null) {
                        activeConns.remove(id);
                    }
                    if (conn != null) {
                        conn.disconnect();
                    }
                }
            });
        }

        private void dispatchJs(String callbackName, String payload) {
            runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
                "window[" + JSONObject.quote(callbackName) + "] && window[" + JSONObject.quote(callbackName)
                + "](" + JSONObject.quote(payload) + ")", null));
        }

        @JavascriptInterface
        public String fetch(String requestJson) {
            return doFetch(requestJson);
        }

        /** 建立连接并处理手动重定向（跨主机剥离 Authorization），供缓冲与流式两条通道复用 */
        private HttpURLConnection openConnection(JSONObject req, String id) throws Exception {
            String url = req.getString("url");
            String method = req.optString("method", "GET");
            JSONObject headers = req.optJSONObject("headers");
            String body = req.optString("body", null);
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            if (id != null) {
                activeConns.put(id, conn);
            }
            conn.setRequestMethod(method);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(300000);
            conn.setInstanceFollowRedirects(false);
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    conn.setRequestProperty(key, headers.getString(key));
                }
            }
            if (body != null && !body.isEmpty()) {
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes(StandardCharsets.UTF_8));
                os.close();
            }
            int status = conn.getResponseCode();
            int redirects = 0;
            while ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && redirects < 5) {
                String location = conn.getHeaderField("Location");
                if (location == null) {
                    break;
                }
                URL next = new URL(conn.getURL(), location);
                boolean sameHost = next.getHost().equalsIgnoreCase(conn.getURL().getHost());
                conn.disconnect();
                activeConns.remove(id);
                conn = (HttpURLConnection) next.openConnection();
                if (id != null) {
                    activeConns.put(id, conn);
                }
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(300000);
                conn.setInstanceFollowRedirects(false);
                if (headers != null) {
                    Iterator<String> keys = headers.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (!sameHost && key.equalsIgnoreCase("authorization")) {
                            continue;
                        }
                        conn.setRequestProperty(key, headers.getString(key));
                    }
                }
                if (status != 307 && status != 308) {
                    conn.setRequestMethod("GET");
                } else {
                    conn.setRequestMethod(method);
                    if (body != null && !body.isEmpty()) {
                        conn.setDoOutput(true);
                        OutputStream os = conn.getOutputStream();
                        os.write(body.getBytes(StandardCharsets.UTF_8));
                        os.close();
                    }
                }
                status = conn.getResponseCode();
                redirects++;
            }
            return conn;
        }

        private String doFetch(String requestJson) {
            String id = null;
            HttpURLConnection conn = null;
            try {
                JSONObject req = new JSONObject(requestJson);
                id = req.optString("id", null);
                boolean binary = req.optBoolean("binary", false);
                conn = openConnection(req, id);
                int status = conn.getResponseCode();
                InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                if (is != null) {
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = is.read(chunk)) > 0) {
                        buffer.write(chunk, 0, n);
                    }
                    is.close();
                }
                JSONObject out = new JSONObject();
                out.put("status", status);
                JSONObject outHeaders = new JSONObject();
                for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                    if (entry.getKey() != null && !entry.getValue().isEmpty()) {
                        outHeaders.put(entry.getKey().toLowerCase(), entry.getValue().get(0));
                    }
                }
                out.put("headers", outHeaders);
                out.put("body", binary
                    ? Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP)
                    : new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                return out.toString();
            } catch (Exception e) {
                try {
                    JSONObject out = new JSONObject();
                    out.put("status", 0);
                    out.put("body", String.valueOf(e.getMessage()));
                    return out.toString();
                } catch (Exception ignored) {
                    return "{\"status\":0}";
                }
            } finally {
                if (id != null) {
                    activeConns.remove(id);
                }
            }
        }
    }

    private void dispatchShare() {
        final String share = pendingShare;
        if (share == null) {
            return;
        }
        pendingShare = null;
        runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('kitechat-share',{detail:" + JSONObject.quote(share) + "}))",
            null));
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                pendingShare = text;
                if (webReady) {
                    dispatchShare();
                }
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShareIntent(intent);
    }

    /** 启动前读取持久化主题（Web 侧 setNativeTheme 写入），决定启动窗口配色；无记录时跟随系统 */
    private boolean resolveDarkTheme() {
        android.content.SharedPreferences prefs = getSharedPreferences("kitechat", MODE_PRIVATE);
        if (prefs.contains("dark")) {
            return prefs.getBoolean("dark", false);
        }
        int night = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return night == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    private void applyStartupTheme(boolean dark) {
        int bg = dark ? Color.parseColor("#151517") : Color.WHITE;
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(bg));
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        androidx.core.view.WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
        final WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(bg);
        webView.evaluateJavascript(
            "document.documentElement.style.background='" + (dark ? "#151517" : "#ffffff") + "';", null);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyStartupTheme(resolveDarkTheme());
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        final WebView webView = getBridge().getWebView();
        webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
        webView.addJavascriptInterface(new NativeHttp(), "KiteNative");
        // 渲染进程崩溃（大图内存峰值等）时恢复页面而非杀掉应用
        webView.setWebViewClient(new com.getcapacitor.BridgeWebViewClient(getBridge()) {
            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                view.post(() -> {
                    try {
                        view.reload();
                    } catch (Exception ignored) {
                    }
                });
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("window.KiteNative && window.KiteNative.webReady && window.KiteNative.webReady()", null);
                view.evaluateJavascript("(function(){return document.body.classList.contains('dark');})()", value -> {
                    if ("true".equals(value)) {
                        view.setBackgroundColor(Color.parseColor("#151517"));
                    }
                });
            }
        });
        // 麦克风：WebView getUserMedia 需原生授权
        final WebChromeClient baseClient = webView.getWebChromeClient();
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                } else {
                    pendingPermissionRequest = request;
                    requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 1002);
                }
            }
            @Override
            public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<android.net.Uri[]> callback, FileChooserParams params) {
                return baseClient != null && baseClient.onShowFileChooser(view, callback, params);
            }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
        // 安全区监听挂在 decor 上，避免 WebView 层级消费 insets 导致偶发丢失
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
            int top = insets.getInsets(WindowInsetsCompat.Type.systemBars()).top;
            int bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom;
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            final float density = getResources().getDisplayMetrics().density;
            final int topPx = Math.round(top / density);
            final int bottomPx = Math.round(bottom / density);
            final int imePx = Math.round(ime / density);
            final String nextInsets = "{\"top\":" + topPx + ",\"bottom\":" + bottomPx + ",\"ime\":" + imePx + "}";
            if (nextInsets.equals(lastInsets)) {
                return insets;
            }
            lastInsets = nextInsets;
            v.post(() -> webView.evaluateJavascript(
                "document.documentElement.style.setProperty('--kitechat-safe-top','" + topPx + "px');"
                + "document.documentElement.style.setProperty('--kitechat-safe-bottom','" + bottomPx + "px');"
                + "document.documentElement.style.setProperty('--kitechat-keyboard','" + imePx + "px');",
                null));
            return insets;
        });

        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){window.dispatchEvent(new Event('kitechat-back'));return window.__kitechatBackHandled===true;})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if (!"true".equals(value)) {
                                finish();
                            }
                        }
                    });
            }
        });

        handleShareIntent(getIntent());
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 1002 && pendingPermissionRequest != null) {
            final PermissionRequest request = pendingPermissionRequest;
            pendingPermissionRequest = null;
            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> request.grant(request.getResources()));
            } else {
                runOnUiThread(() -> request.deny());
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        WebView webView = getBridge().getWebView();
        webView.evaluateJavascript(
            "(function(){return document.body.classList.contains('dark');})()",
            value -> {
                boolean dark = "true".equals(value);
                androidx.core.view.WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                controller.setAppearanceLightStatusBars(!dark);
                controller.setAppearanceLightNavigationBars(!dark);
            });
    }
}