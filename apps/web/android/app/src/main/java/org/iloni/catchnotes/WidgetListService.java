package org.iloni.catchnotes;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class WidgetListService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        return new RemoteViewsFactory() {
            private List<JSONObject> notes = Collections.emptyList();
            private boolean dark;
            private boolean customTheme;
            private boolean single;
            private final List<String> sections = new ArrayList<>();

            public void onCreate() {
                onDataSetChanged();
            }

            public void onDataSetChanged() {
                JSONObject config = WidgetStore.config(WidgetListService.this, id);
                notes =
                        WidgetStore.notes(
                                WidgetStore.snapshot(WidgetListService.this, config), config);
                single = "single".equals(config.optString("kind"));
                sections.clear();
                if (single && !notes.isEmpty()) {
                    JSONArray text = notes.get(0).optJSONArray("sections");
                    if (text == null || text.length() == 0)
                        sections.add(notes.get(0).optString("body"));
                    else for (int i = 0; i < text.length(); i++) sections.add(text.optString(i));
                }
                customTheme = !"system".equals(config.optString("theme", "system"));
                dark = CatchWidgetProvider.dark(WidgetListService.this, config);
            }

            public void onDestroy() {
                notes = Collections.emptyList();
                sections.clear();
            }

            public int getCount() {
                return single ? sections.size() : notes.size();
            }

            public RemoteViews getViewAt(int position) {
                if (position < 0 || position >= getCount()) return null;
                if (single) {
                    JSONObject note = notes.get(0);
                    RemoteViews row =
                            new RemoteViews(
                                    getPackageName(),
                                    customTheme
                                            ? R.layout.widget_single_row_custom
                                            : R.layout.widget_single_row);
                    row.setTextViewText(R.id.widget_title, note.optString("title"));
                    row.setViewVisibility(
                            R.id.widget_title, position == 0 ? View.VISIBLE : View.GONE);
                    row.setTextViewText(R.id.widget_body, sections.get(position));
                    row.setViewPadding(
                            R.id.widget_body,
                            0,
                            position == 0
                                    ? Math.round(10 * getResources().getDisplayMetrics().density)
                                    : 0,
                            0,
                            0);
                    WidgetImages.apply(row, position == 0 ? note : new JSONObject());
                    if (customTheme) {
                        row.setTextColor(R.id.widget_title, CatchWidgetProvider.ink(dark));
                        row.setTextColor(R.id.widget_body, CatchWidgetProvider.ink(dark));
                    }
                    row.setOnClickFillInIntent(
                            R.id.widget_row, new Intent().putExtra("noteId", note.optString("id")));
                    return row;
                }
                JSONObject note = notes.get(position);
                RemoteViews row =
                        new RemoteViews(
                                getPackageName(),
                                customTheme
                                        ? R.layout.widget_row_images_custom
                                        : R.layout.widget_row_images);
                row.setTextViewText(R.id.widget_title, note.optString("title"));
                row.setTextViewText(R.id.widget_body, note.optString("body"));
                WidgetImages.apply(row, note);
                String color = note.optString("color", "default");
                int drawable =
                        getResources()
                                .getIdentifier(
                                        "widget_card_" + color.replace('-', '_'),
                                        "drawable",
                                        getPackageName());
                row.setImageViewResource(
                        R.id.widget_card,
                        drawable == 0 ? R.drawable.widget_card_default : drawable);
                if (customTheme) {
                    row.setInt(
                            R.id.widget_card,
                            "setColorFilter",
                            "default".equals(color)
                                    ? (dark ? 0xff3b3832 : 0xffffffff)
                                    : WidgetColors.surface(WidgetListService.this, color, dark));
                    row.setTextColor(R.id.widget_title, CatchWidgetProvider.ink(dark));
                    row.setTextColor(R.id.widget_body, CatchWidgetProvider.muted(dark));
                }
                row.setOnClickFillInIntent(
                        R.id.widget_row, new Intent().putExtra("noteId", note.optString("id")));
                return row;
            }

            public RemoteViews getLoadingView() {
                return null;
            }

            public int getViewTypeCount() {
                return 1;
            }

            public long getItemId(int position) {
                return position;
            }

            public boolean hasStableIds() {
                return false;
            }
        };
    }
}
