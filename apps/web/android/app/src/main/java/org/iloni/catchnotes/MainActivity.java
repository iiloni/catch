package org.iloni.catchnotes;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private Intent initialIntent;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        initialIntent = getIntent();
        // Delivery ids are ours: another app must not choose the id of an existing note.
        // Recreation retains our marker, while a fresh external launch always gets a new one.
        if (savedInstanceState == null && initialIntent != null) initialIntent.removeExtra(IncomingSharesPlugin.RECEIPT);
        registerPlugin(HapticFeedbackPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(KeyboardInsetsPlugin.class);
        registerPlugin(IncomingSharesPlugin.class);
        registerPlugin(OutgoingSharesPlugin.class);
        registerPlugin(RemindersPlugin.class);
        super.onCreate(savedInstanceState);
        // The page scrollbar is drawn by the WebView separately from nested CSS scrollers.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // BridgeActivity also calls this with the initial intent during onCreate.
        if (intent != null && intent != initialIntent) intent.removeExtra(IncomingSharesPlugin.RECEIPT);
        super.onNewIntent(intent);
    }
}
