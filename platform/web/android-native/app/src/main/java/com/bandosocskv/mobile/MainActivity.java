package com.bandosocskv.mobile;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Giữ cỡ chữ theo máy nhưng không quá 115% để bố cục không vỡ khi người dùng phóng to chữ hệ thống.
    private static final int MAX_TEXT_ZOOM = 115;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebSettings settings = getBridge().getWebView().getSettings();
            if (settings.getTextZoom() > MAX_TEXT_ZOOM) settings.setTextZoom(MAX_TEXT_ZOOM);
        }
    }
}
