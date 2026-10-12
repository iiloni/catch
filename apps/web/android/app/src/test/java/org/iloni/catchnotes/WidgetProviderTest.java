package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAppWidgetManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class WidgetProviderTest {
    private Context context;
    private ShadowAppWidgetManager manager;

    @Before
    public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        manager = Shadows.shadowOf(AppWidgetManager.getInstance(context));
        manager.setAlwaysRecreateViewsDuringUpdate(false);
        WidgetStore.clear(context, null);
        String session =
                WidgetStore.begin(
                        context,
                        "alice",
                        "https://catch.example",
                        new JSONArray("[{id:'alice',label:'Alice'}]"));
        WidgetStore.sync(
                context,
                session,
                new JSONObject(
                        "{version:1,notes:[{id:'one',title:'Private shopping"
                            + " list',body:'Bread',color:'yellow',pinned:true}],tags:[],columns:[]}"));
    }

    @Test
    public void singleNoteDropsItsTextImmediatelyOnSignOut() throws Exception {
        int id = manager.createWidget(CatchWidgetProvider.Single.class, R.layout.widget_single);
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(context, CatchWidgetProvider.Single.class);
        manager.putWidgetInfo(id, info);
        WidgetStore.configure(
                context,
                id,
                new JSONObject("{account:'alice',kind:'single',target:'one',theme:'light'}"));
        CatchWidgetProvider.update(context, id);
        WidgetListService service =
                org.robolectric.Robolectric.buildService(WidgetListService.class).create().get();
        android.widget.RemoteViewsService.RemoteViewsFactory factory =
                service.onGetViewFactory(
                        new android.content.Intent()
                                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id));
        factory.onCreate();
        View row = factory.getViewAt(0).apply(context, null);
        assertEquals(
                "Private shopping list",
                ((TextView) row.findViewById(R.id.widget_title)).getText().toString());
        WidgetStore.clear(context, "alice");
        CatchWidgetProvider.update(context, id);
        assertEquals(
                View.GONE, manager.getViewFor(id).findViewById(R.id.widget_note).getVisibility());
        assertEquals(
                View.VISIBLE,
                manager.getViewFor(id).findViewById(R.id.widget_empty).getVisibility());
        factory.onDataSetChanged();
        assertEquals(0, factory.getCount());
        assertNull(factory.getViewAt(0));
    }

    @Test
    public void listHidesCachedServiceRowsImmediatelyOnSignOut() throws Exception {
        int id = manager.createWidget(CatchWidgetProvider.Notes.class, R.layout.widget_list);
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(context, CatchWidgetProvider.Notes.class);
        manager.putWidgetInfo(id, info);
        WidgetStore.configure(
                context,
                id,
                new JSONObject("{account:'alice',kind:'list',filter:'pinned',theme:'light'}"));
        CatchWidgetProvider.update(context, id);
        WidgetStore.clear(context, "alice");
        CatchWidgetProvider.update(context, id);
        View view = manager.getViewFor(id);
        assertEquals(View.GONE, view.findViewById(R.id.widget_list).getVisibility());
        assertEquals(View.VISIBLE, view.findViewById(R.id.widget_empty).getVisibility());
    }
}
