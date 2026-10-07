package org.iloni.catchnotes;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OutgoingShares")
public class OutgoingSharesPlugin extends Plugin {
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("There is no content to share.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                getActivity().startActivity(Intent.createChooser(send, null));
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Could not open the share menu.", error);
            }
        });
    }
}
