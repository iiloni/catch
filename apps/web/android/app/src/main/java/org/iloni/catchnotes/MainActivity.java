package org.iloni.catchnotes;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HapticFeedbackPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(KeyboardInsetsPlugin.class);
        super.onCreate(savedInstanceState);
        // The page scrollbar is drawn by the WebView separately from nested CSS scrollers.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }
}
