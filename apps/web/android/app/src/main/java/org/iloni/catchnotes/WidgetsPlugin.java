package org.iloni.catchnotes;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "Widgets")
public class WidgetsPlugin extends Plugin {
    static final String ACTION = "org.iloni.catchnotes.WIDGET_OPEN";

    @Override
    public void load() {
        opened(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        opened(intent);
    }

    private void opened(Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        intent.setAction(Intent.ACTION_MAIN);
        int id = intent.getIntExtra("widgetId", -1);
        if (CatchWidgetProvider.kind(getContext(), id) == null) return;
        try {
            JSONObject launch =
                    WidgetStore.launch(
                            getContext(),
                            id,
                            intent.getStringExtra("command"),
                            intent.getStringExtra("noteId"));
            if (launch != null) notifyListeners("launch", new JSObject());
        } catch (RuntimeException error) {
            Log.e("CatchWidgets", "Widget launch could not be saved", error);
        }
    }

    @PluginMethod
    public void begin(PluginCall call) {
        String account = call.getString("account");
        String server = call.getString("server");
        if (account == null || server == null) {
            call.reject("Missing widget account");
            return;
        }
        try {
            String session =
                    WidgetStore.begin(
                            getContext(),
                            account,
                            server,
                            call.getArray("accounts", new JSArray()));
            CatchWidgetProvider.updateAll(getContext());
            call.resolve(new JSObject().put("session", session));
        } catch (RuntimeException error) {
            call.reject("Widgets could not be initialized", error);
        }
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("Missing widget snapshot");
            return;
        }
        try {
            if (WidgetStore.sync(getContext(), call.getString("session"), snapshot))
                CatchWidgetProvider.updateAll(getContext());
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Widgets could not be updated", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            WidgetStore.clear(getContext(), call.getString("account"));
            CatchWidgetProvider.updateAll(getContext());
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Widget data could not be cleared", error);
        }
    }

    @PluginMethod
    public void pending(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(WidgetStore.pending(getContext())));
        } catch (org.json.JSONException | RuntimeException error) {
            call.reject("Widget launch could not be read", error);
        }
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        try {
            WidgetStore.acknowledge(getContext(), call.getString("id", ""));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Widget launch could not be acknowledged", error);
        }
    }
}
