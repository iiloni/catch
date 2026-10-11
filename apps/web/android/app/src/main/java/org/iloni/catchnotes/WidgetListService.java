package org.iloni.catchnotes;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONObject;

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

            public void onCreate() {
                onDataSetChanged();
            }

            public void onDataSetChanged() {
                JSONObject config = WidgetStore.config(WidgetListService.this, id);
                notes =
                        WidgetStore.notes(
                                WidgetStore.snapshot(WidgetListService.this, config), config);
                customTheme = !"system".equals(config.optString("theme", "system"));
                dark = CatchWidgetProvider.dark(WidgetListService.this, config);
            }

            public void onDestroy() {
                notes = Collections.emptyList();
            }

            public int getCount() {
                return notes.size();
            }

            public RemoteViews getViewAt(int position) {
                if (position < 0 || position >= notes.size()) return null;
                JSONObject note = notes.get(position);
                RemoteViews row =
                        new RemoteViews(
                                getPackageName(),
                                customTheme ? R.layout.widget_row_custom : R.layout.widget_row);
                row.setTextViewText(R.id.widget_title, note.optString("title"));
                row.setTextViewText(R.id.widget_body, note.optString("body").replace('\n', ' '));
                if (customTheme) {
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
