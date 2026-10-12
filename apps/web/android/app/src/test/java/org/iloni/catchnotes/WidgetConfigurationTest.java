package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.app.Dialog;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class WidgetConfigurationTest {
    private Context context;
    private int id;
    private Intent intent;

    @Before
    public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        WidgetStore.clear(context, null);
        WidgetStore.begin(
                context,
                "alice",
                "https://catch.example",
                new JSONArray("[{id:'alice',label:'Alice'}]"));
        org.robolectric.shadows.ShadowAppWidgetManager manager =
                Shadows.shadowOf(AppWidgetManager.getInstance(context));
        id = manager.createWidget(CatchWidgetProvider.Notes.class, R.layout.widget_list);
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(context, CatchWidgetProvider.Notes.class);
        manager.putWidgetInfo(id, info);
        WidgetStore.configure(
                context,
                id,
                new JSONObject("{account:'alice',kind:'list',filter:'pinned',theme:'system'}"));
        intent =
                new Intent(context, WidgetConfigurationActivity.class)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
    }

    @Test
    public void savesGalleryWithoutRequiringASelectionOrSnapshot() {
        ActivityController<WidgetConfigurationActivity> controller =
                Robolectric.buildActivity(WidgetConfigurationActivity.class, intent).setup();
        View root = controller.get().getWindow().getDecorView();
        find(root, "Show\n").performClick();
        find(pickerRoot(), "Gallery").performClick();
        find(root, "Save widget").performClick();
        assertEquals("gallery", WidgetStore.config(context, id).optString("filter"));
        assertEquals("", WidgetStore.config(context, id).optString("target"));
        assertEquals(
                android.app.Activity.RESULT_OK, Shadows.shadowOf(controller.get()).getResultCode());
        controller.pause().stop().destroy();
    }

    @Test
    public void keepsDraftThroughRecreationAndCancelDoesNotSaveIt() {
        ActivityController<WidgetConfigurationActivity> controller =
                Robolectric.buildActivity(WidgetConfigurationActivity.class, intent).setup();
        find(controller.get().getWindow().getDecorView(), "Show\n").performClick();
        find(pickerRoot(), "All notes").performClick();
        Bundle draft = new Bundle();
        controller.saveInstanceState(draft).pause().stop().destroy();
        controller =
                Robolectric.buildActivity(WidgetConfigurationActivity.class, intent)
                        .create(draft)
                        .start()
                        .resume()
                        .visible();
        assertTrue(
                find(controller.get().getWindow().getDecorView(), "Show\n")
                        .getText()
                        .toString()
                        .contains("All notes"));
        find(controller.get().getWindow().getDecorView(), "Cancel").performClick();
        assertEquals("pinned", WidgetStore.config(context, id).optString("filter"));
        assertEquals(
                android.app.Activity.RESULT_CANCELED,
                Shadows.shadowOf(controller.get()).getResultCode());
        controller.pause().stop().destroy();
    }

    @Test
    public void largeNotePickerCreatesOnlyVisibleRows() throws Exception {
        org.robolectric.shadows.ShadowAppWidgetManager manager =
                Shadows.shadowOf(AppWidgetManager.getInstance(context));
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(context, CatchWidgetProvider.Single.class);
        manager.putWidgetInfo(id, info);
        String session =
                WidgetStore.begin(
                        context,
                        "alice",
                        "https://catch.example",
                        new JSONArray("[{id:'alice',label:'Alice'}]"));
        JSONArray notes = new JSONArray();
        for (int i = 0; i < 5000; i++)
            notes.put(new JSONObject().put("id", "note-" + i).put("title", "Note " + i));
        WidgetStore.sync(context, session, new JSONObject().put("version", 1).put("notes", notes));
        ActivityController<WidgetConfigurationActivity> controller =
                Robolectric.buildActivity(WidgetConfigurationActivity.class, intent).setup();
        find(controller.get().getWindow().getDecorView(), "Note\n").performClick();
        Dialog picker = ShadowDialog.getLatestDialog();
        android.widget.ListView list = findList(picker.getWindow().getDecorView());
        assertNotNull(list);
        assertEquals(5000, list.getAdapter().getCount());
        list.measure(
                View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY));
        list.layout(0, 0, 320, 300);
        assertTrue(list.getChildCount() > 0);
        assertTrue(list.getChildCount() < 20);
        ((TextView) list.getChildAt(1)).performClick();
        find(controller.get().getWindow().getDecorView(), "Save widget").performClick();
        assertEquals("note-1", WidgetStore.config(context, id).optString("target"));
        controller.pause().stop().destroy();
    }

    private static View pickerRoot() {
        View root = ShadowDialog.getLatestDialog().getWindow().getDecorView();
        android.widget.ListView list = findList(root);
        list.measure(
                View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY));
        list.layout(0, 0, 320, 300);
        return root;
    }

    private static android.widget.ListView findList(View view) {
        if (view instanceof android.widget.ListView) return (android.widget.ListView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.widget.ListView found = findList(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private static TextView find(View view, String prefix) {
        if (view instanceof TextView && ((TextView) view).getText().toString().startsWith(prefix))
            return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                TextView found = find(group.getChildAt(i), prefix);
                if (found != null) return found;
            }
        }
        return null;
    }
}
