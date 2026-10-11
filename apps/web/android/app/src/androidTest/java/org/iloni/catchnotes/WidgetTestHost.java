package org.iloni.catchnotes;

import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.widget.LinearLayout;
import android.widget.ScrollView;

import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;

/** A real launcher host for device verification, installed only in the instrumentation APK. */
final class WidgetTestHost {
    public static final int HOST_ID = 223;

    static AppWidgetHost render(Activity activity, String theme) {
        try {
            // Fixtures may render above the keyguard; this does not unlock the phone.
            activity.getWindow()
                    .addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (android.os.Build.VERSION.SDK_INT >= 27) {
                activity.setShowWhenLocked(true);
                activity.setTurnScreenOn(true);
            } else {
                activity.getWindow()
                        .addFlags(
                                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                                        | android.view.WindowManager.LayoutParams
                                                .FLAG_TURN_SCREEN_ON);
            }
            Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
            AppWidgetManager manager = AppWidgetManager.getInstance(target);
            AppWidgetHost host = new AppWidgetHost(target, HOST_ID);
            seed(target);
            LinearLayout content = new LinearLayout(activity);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(
                    dp(activity, 16), dp(activity, 24), dp(activity, 16), dp(activity, 24));
            content.setBackgroundColor(0xff647e70);
            ScrollView scroll = new ScrollView(activity);
            scroll.addView(content);
            activity.setContentView(scroll);
            Class<?>[] providers = {
                CatchWidgetProvider.Capture.class,
                CatchWidgetProvider.Single.class,
                CatchWidgetProvider.Notes.class
            };
            String[] kinds = {"capture", "single", "list"};
            host.startListening();
            for (int i = 0; i < providers.length; i++) {
                int id = host.allocateAppWidgetId();
                ComponentName provider = new ComponentName(target, providers[i]);
                if (!manager.bindAppWidgetIdIfAllowed(id, provider))
                    throw new IllegalStateException("Widget host has no bind permission");
                JSONObject config =
                        new JSONObject()
                                .put("account", "widget-test")
                                .put("kind", kinds[i])
                                .put("filter", "pinned")
                                .put("target", "0198f3a0-0000-7000-8000-000000000001")
                                .put("theme", theme);
                WidgetStore.configure(target, id, config);
                android.appwidget.AppWidgetProviderInfo info = manager.getAppWidgetInfo(id);
                if (i == 2
                        && (info.configure == null
                                || (info.widgetFeatures
                                                & android.appwidget.AppWidgetProviderInfo
                                                        .WIDGET_FEATURE_RECONFIGURABLE)
                                        == 0))
                    throw new IllegalStateException("List widget must support launcher setup");
                AppWidgetHostView view = host.createView(target, id, info);
                int height = i == 0 ? 56 : i == 1 ? 300 : 340;
                Bundle options = new Bundle();
                options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 320);
                options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height);
                manager.updateAppWidgetOptions(id, options);
                // Capture's declared one-row minimum plus the host's own outer padding.
                int hostHeight = dp(activity, height);
                if (i == 0) hostHeight += view.getPaddingTop() + view.getPaddingBottom();
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, hostHeight);
                params.bottomMargin = dp(activity, 14);
                content.addView(view, params);
                CatchWidgetProvider.update(target, id);
            }
            return host;
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    static void seed(Context target) {
        try {
            String session =
                    WidgetStore.begin(
                            target,
                            "widget-test",
                            "https://widget-test.invalid",
                            new JSONArray("[{id:'widget-test',label:'Personal'}]"));
            WidgetStore.sync(
                    target,
                    session,
                    new JSONObject(
                            "{version:1,notes:[{id:'0198f3a0-0000-7000-8000-000000000001',title:'Saturday"
                                + " market',body:'☐ Peaches & tomatoes\\n"
                                + "☐ Sourdough\\n"
                                + "☑ Coffee"
                                + " beans',color:'yellow',pinned:true,column:null,tags:[]},{id:'0198f3a0-0000-7000-8000-000000000002',title:'Cabin"
                                + " weekend',body:'Check-in after 3 · bring the"
                                + " key',color:'default',pinned:true,column:null,tags:[]},{id:'0198f3a0-0000-7000-8000-000000000003',title:'Weekend"
                                + " errands',body:'☐ Return library books\\n"
                                + "☐ Pick up"
                                + " groceries',color:'default',pinned:true,column:null,tags:[]}],tags:[],columns:[]}"));
        } catch (org.json.JSONException error) {
            throw new IllegalArgumentException(error);
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
