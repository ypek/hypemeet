package com.mihawkdev.hypetv;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * HypeTv on Android TV: the TV page (plugins/hypetv, vite build --mode tv) in a full-screen WebView.
 *
 * The page does the remote's navigation itself (src/lib/tv.ts). Here: Back asks the page to close what's open
 * (window.hypetvBack) and leaves the app when there's nothing left; media and channel keys, which the WebView would
 * keep to itself, are handed to the page as key names (window.hypetvKey).
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://hypetv.mihawkdev.com/tv/";
    private static final int CANVAS = 0xFF131418;

    private WebView web;
    private FrameLayout root;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenDone;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        root = new FrameLayout(this);
        root.setBackgroundColor(CANVAS);
        web = new WebView(this);
        web.setBackgroundColor(CANVAS);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        // The page turns TV mode on from this (and from the /tv/ build itself).
        s.setUserAgentString(s.getUserAgentString() + " HypeTvAndroidTV/" + BuildConfig.VERSION);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
        web.requestFocus();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) back();
            return true;
        }
        String key = pageKey(code);
        if (key != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) web.evaluateJavascript("window.hypetvKey&&window.hypetvKey('" + key + "')", null);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    /** Remote keys the page handles, by the names it knows them by (KeyboardEvent.key). */
    private static String pageKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_STOP:
                return "MediaStop";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                return "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return "MediaRewind";
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                return "ChannelUp";
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return "ChannelDown";
            default:
                return null;
        }
    }

    private void back() {
        if (fullscreen != null) {
            leaveFullscreen();
            return;
        }
        web.evaluateJavascript("window.hypetvBack?String(window.hypetvBack()):'none'", value -> {
            if ("\"true\"".equals(value)) return;
            // Not the HypeTv page (an error page, say): browser-style back first.
            if ("\"none\"".equals(value) && web.canGoBack()) web.goBack();
            else finish();
        });
    }

    private void leaveFullscreen() {
        if (fullscreen == null) return;
        root.removeView(fullscreen);
        fullscreen = null;
        web.setVisibility(View.VISIBLE);
        if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
        fullscreenDone = null;
        web.requestFocus();
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) view.loadDataWithBaseURL(HOME, offline(String.valueOf(error.getDescription())), "text/html", "utf-8", null);
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback done) {
            if (fullscreen != null) {
                done.onCustomViewHidden();
                return;
            }
            fullscreen = view;
            fullscreenDone = done;
            web.setVisibility(View.GONE);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override
        public void onHideCustomView() {
            leaveFullscreen();
        }

        /** No grey play-button poster over videos before they start. */
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }

    /** What shows when the server can't be reached: the reason and a button (focused) to try again. */
    private static String offline(String reason) {
        String safe = reason.replace("&", "&amp;").replace("<", "&lt;");
        return "<!doctype html><html lang=pt-BR><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#131418;color:#f2f3f7;font-family:sans-serif;text-align:center'>"
                + "<div><p style='font-size:28px;font-weight:800;margin:0 0 8px'>Sem conexão com o HypeTv</p>"
                + "<p style='color:#a4a9b8;margin:0 0 24px'>Confira a internet da TV e tente de novo. (" + safe + ")</p>"
                + "<button id=retry autofocus onclick=\"location.replace('" + HOME + "')\" style='font:inherit;font-weight:700;font-size:20px;padding:12px 28px;border-radius:999px;border:4px solid #b1a0ff;background:#9070ff;color:#121019'>Tentar de novo</button></div>"
                + "<script>window.hypetvBack=function(){return false};document.getElementById('retry').focus()</script></body></html>";
    }
}
