package org.iloni.catchnotes;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.List;

public class CatchWidgetProvider extends AppWidgetProvider {
    public static class Capture extends CatchWidgetProvider {}

    public static class Single extends CatchWidgetProvider {}

    public static class Notes extends CatchWidgetProvider {}

    private static final Class<?>[] PROVIDERS = {Capture.class, Single.class, Notes.class};

    static String kind(Context context, int id) {
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        if (info == null || !context.getPackageName().equals(info.provider.getPackageName()))
            return null;
        String name = info.provider.getClassName();
        return name.equals(Capture.class.getName())
                ? "capture"
                : name.equals(Single.class.getName())
                        ? "single"
                        : name.equals(Notes.class.getName()) ? "list" : null;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(
            Context context, AppWidgetManager manager, int id, Bundle options) {
        update(context, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) WidgetStore.delete(context, id);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        for (Class<?> provider : PROVIDERS)
            for (int id : manager.getAppWidgetIds(new ComponentName(context, provider)))
                update(context, id);
    }

    static boolean dark(Context context, JSONObject config) {
        String theme = config.optString("theme", "system");
        return "dark".equals(theme)
                || ("system".equals(theme)
                        && (context.getResources().getConfiguration().uiMode
                                        & Configuration.UI_MODE_NIGHT_MASK)
                                == Configuration.UI_MODE_NIGHT_YES);
    }

    static int ink(boolean dark) {
        return dark ? 0xfff6f0e5 : 0xff302e29;
    }

    static int muted(boolean dark) {
        return dark ? 0xffc4bbaa : 0xff716b60;
    }

    static PendingIntent configureIntent(Context context, int id) {
        Intent intent =
                new Intent(context, WidgetConfigurationActivity.class)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                        .setData(Uri.parse("catch-widget://configure/" + id));
        return PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openIntent(
            Context context, int id, String action, String noteId, boolean template) {
        Intent intent =
                new Intent(context, MainActivity.class)
                        .setAction(WidgetsPlugin.ACTION)
                        .setData(Uri.parse("catch-widget://open/" + id + "/" + action))
                        .putExtra("widgetId", id)
                        .putExtra("command", action);
        if (noteId != null) intent.putExtra("noteId", noteId);
        return PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (template ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE));
    }

    static void update(Context context, int id) {
        String kind = kind(context, id);
        if (kind == null) return;
        JSONObject config = WidgetStore.config(context, id);
        JSONObject account = WidgetStore.account(context, config.optString("account"));
        JSONObject snapshot = WidgetStore.snapshot(context, config);
        boolean dark = dark(context, config);
        boolean customTheme = !"system".equals(config.optString("theme", "system"));
        int layout =
                "capture".equals(kind)
                        ? (customTheme ? R.layout.widget_capture_custom : R.layout.widget_capture)
                        : "single".equals(kind)
                                ? (customTheme
                                        ? R.layout.widget_single_scroll_custom
                                        : R.layout.widget_single_scroll)
                                : (customTheme
                                        ? R.layout.widget_list_minimal_custom
                                        : R.layout.widget_list_minimal);
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        // Reset a previous note surface even when the selected note is no longer available.
        views.setImageViewResource(R.id.widget_surface, R.drawable.widget_surface);
        if (customTheme) {
            views.setInt(R.id.widget_surface, "setColorFilter", dark ? 0xff302e29 : 0xfffff9f0);
            if (!"list".equals(kind))
                views.setInt(R.id.widget_settings, "setColorFilter", ink(dark));
        }
        if (!"list".equals(kind))
            views.setOnClickPendingIntent(R.id.widget_settings, configureIntent(context, id));
        boolean signedIn = account.length() > 0;
        if ("capture".equals(kind)) {
            views.setTextViewText(R.id.widget_compose, signedIn ? "New note" : "Set up Catch");
            views.setContentDescription(
                    R.id.widget_compose,
                    signedIn ? "New note · " + account.optString("label") : "Set up Catch widget");
            views.setOnClickPendingIntent(
                    R.id.widget_compose,
                    signedIn
                            ? openIntent(context, id, "compose", null, false)
                            : configureIntent(context, id));
            views.setOnClickPendingIntent(
                    R.id.widget_search,
                    signedIn
                            ? openIntent(context, id, "search", null, false)
                            : configureIntent(context, id));
            if (customTheme) {
                views.setInt(R.id.widget_search, "setColorFilter", ink(dark));
                int button =
                        dark
                                ? R.drawable.widget_capture_button_dark
                                : R.drawable.widget_capture_button_light;
                views.setInt(R.id.widget_settings, "setBackgroundResource", button);
                views.setInt(R.id.widget_search, "setBackgroundResource", button);
            }
            int width =
                    AppWidgetManager.getInstance(context)
                            .getAppWidgetOptions(id)
                            .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
            views.setViewVisibility(
                    R.id.widget_search, width > 0 && width < 250 ? View.GONE : View.VISIBLE);
        } else {
            if (customTheme && "single".equals(kind)) {
                views.setTextColor(R.id.widget_heading, ink(dark));
                views.setTextColor(R.id.widget_footer, muted(dark));
            }
            List<JSONObject> notes = WidgetStore.notes(snapshot, config);
            if ("single".equals(kind)) {
                String updated =
                        account.optLong("updated") == 0
                                ? "Open Catch to load notes"
                                : "Updated "
                                        + android.text.format.DateFormat.getDateFormat(context)
                                                .format(
                                                        new java.util.Date(
                                                                account.optLong("updated")))
                                        + " "
                                        + android.text.format.DateFormat.getTimeFormat(context)
                                                .format(
                                                        new java.util.Date(
                                                                account.optLong("updated")));
                views.setTextViewText(
                        R.id.widget_footer,
                        signedIn
                                ? account.optString("label") + " · " + updated
                                : "Choose an account in widget settings");
                JSONObject note = notes.isEmpty() ? null : notes.get(0);
                int height =
                        AppWidgetManager.getInstance(context)
                                .getAppWidgetOptions(id)
                                .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 250);
                boolean compact = height < 220;
                views.setViewVisibility(R.id.widget_footer, compact ? View.GONE : View.VISIBLE);
                views.setTextViewText(R.id.widget_heading, "Catch");
                views.setTextViewText(
                        R.id.widget_empty, "Open widget settings to choose an available note.");
                views.setOnClickPendingIntent(R.id.widget_empty, configureIntent(context, id));
                views.setViewVisibility(R.id.widget_note, note == null ? View.GONE : View.VISIBLE);
                views.setViewVisibility(R.id.widget_empty, note == null ? View.VISIBLE : View.GONE);
                if (note != null) {
                    Intent service =
                            new Intent(context, WidgetListService.class)
                                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                                    .setData(Uri.parse("catch-widget://single/" + id));
                    views.setRemoteAdapter(R.id.widget_note, service);
                    views.setPendingIntentTemplate(
                            R.id.widget_note, openIntent(context, id, "note", null, true));
                }
                if (customTheme) {
                    views.setTextColor(R.id.widget_empty, ink(dark));
                    if (note != null)
                        views.setInt(
                                R.id.widget_surface,
                                "setColorFilter",
                                WidgetColors.surface(context, note.optString("color"), dark));
                } else if (note != null) {
                    int surface =
                            context.getResources()
                                    .getIdentifier(
                                            "widget_surface_"
                                                    + note.optString("color").replace('-', '_'),
                                            "drawable",
                                            context.getPackageName());
                    if (surface != 0) views.setImageViewResource(R.id.widget_surface, surface);
                }
            } else {
                String filter = config.optString("filter", "pinned");
                String heading =
                        "pinned".equals(filter)
                                ? "Pinned"
                                : "gallery".equals(filter)
                                        ? "Gallery"
                                        : "all".equals(filter)
                                                ? "All notes"
                                                : WidgetStore.choiceName(
                                                        snapshot,
                                                        "tag".equals(filter) ? "tags" : "columns",
                                                        config.optString("target"));
                boolean missing = heading.isEmpty();
                views.setContentDescription(
                        R.id.widget_list,
                        (missing ? "Note list" : heading)
                                + (signedIn ? " · " + account.optString("label") : ""));
                views.setTextViewText(
                        R.id.widget_empty,
                        !signedIn
                                ? "Set up this widget to see notes."
                                : missing
                                        ? "This list is no longer available."
                                        : account.optLong("updated") == 0
                                                ? "Open Catch to load notes."
                                                : "No notes here yet.");
                if (customTheme) views.setTextColor(R.id.widget_empty, muted(dark));
                views.setOnClickPendingIntent(R.id.widget_empty, configureIntent(context, id));
                views.setOnClickPendingIntent(
                        R.id.widget_compose,
                        signedIn && !missing
                                ? openIntent(context, id, "compose", null, false)
                                : configureIntent(context, id));
                if (signedIn && !missing) {
                    views.setViewVisibility(R.id.widget_list, View.VISIBLE);
                    Intent service =
                            new Intent(context, WidgetListService.class)
                                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                                    .setData(Uri.parse("catch-widget://list/" + id));
                    views.setRemoteAdapter(R.id.widget_list, service);
                    views.setEmptyView(R.id.widget_list, R.id.widget_empty);
                    views.setPendingIntentTemplate(
                            R.id.widget_list, openIntent(context, id, "note", null, true));
                } else {
                    // A full redraw hides cached service rows immediately when an account leaves.
                    views.setViewVisibility(R.id.widget_list, View.GONE);
                    views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
                }
            }
        }
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        manager.updateAppWidget(id, views);
        if ("list".equals(kind) || "single".equals(kind))
            manager.notifyAppWidgetViewDataChanged(
                    id, "single".equals(kind) ? R.id.widget_note : R.id.widget_list);
    }
}
