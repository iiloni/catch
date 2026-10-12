package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.util.Base64;
import android.view.View;
import android.widget.ImageView;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.ByteArrayOutputStream;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 36})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class WidgetImagesTest {
    private static String image(int width, int height) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(0xff4385c6);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, bytes);
        bitmap.recycle();
        return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    @Test
    public void rejectsInvalidOrOversizedPixelsAndClearsARecycledRow() throws Exception {
        assertNull(WidgetImages.decode(new JSONObject("{image:'!invalid!'}")));
        assertNull(WidgetImages.decode(new JSONObject().put("image", image(321, 1))));
        assertNull(
                WidgetImages.decode(
                        new JSONObject()
                                .put("image", new String(new char[64001]).replace('\0', 'a'))));
        JSONObject photo = new JSONObject().put("image", image(320, 200));
        Bitmap bitmap = WidgetImages.decode(photo);
        assertNotNull(bitmap);
        assertEquals(320, bitmap.getWidth());
        bitmap.recycle();
        Context context = RuntimeEnvironment.getApplication();
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_row);
        WidgetImages.apply(views, photo);
        View row = views.apply(context, null);
        ImageView preview = row.findViewById(R.id.widget_image);
        assertEquals(View.VISIBLE, preview.getVisibility());
        assertNotNull(preview.getDrawable());
        WidgetImages.apply(views, new JSONObject());
        views.reapply(context, row);
        assertEquals(View.GONE, preview.getVisibility());
    }

    @Test
    public void singleNoteHasEverySectionAndOnlyOneTitleAndImage() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        WidgetStore.clear(context, null);
        String session =
                WidgetStore.begin(
                        context, "alice", "https://catch.example", new JSONArray("[{id:'alice'}]"));
        JSONObject note =
                new JSONObject(
                                "{id:'one',title:'Long"
                                        + " note',body:'Preview',color:'yellow',sections:['First"
                                        + " section','Final section']}")
                        .put("image", image(160, 100));
        WidgetStore.sync(
                context,
                session,
                new JSONObject().put("version", 1).put("notes", new JSONArray().put(note)));
        WidgetStore.configure(
                context, 42, new JSONObject("{account:'alice',kind:'single',target:'one'}"));
        WidgetListService service =
                Robolectric.buildService(WidgetListService.class).create().get();
        RemoteViewsService.RemoteViewsFactory factory =
                service.onGetViewFactory(
                        new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 42));
        factory.onCreate();
        assertEquals(2, factory.getCount());
        View first = factory.getViewAt(0).apply(context, null);
        assertEquals(View.VISIBLE, first.findViewById(R.id.widget_title).getVisibility());
        assertEquals(View.VISIBLE, first.findViewById(R.id.widget_image).getVisibility());
        factory.getViewAt(1).reapply(context, first);
        assertEquals(
                "Final section",
                ((TextView) first.findViewById(R.id.widget_body)).getText().toString());
        assertEquals(View.GONE, first.findViewById(R.id.widget_title).getVisibility());
        assertEquals(View.GONE, first.findViewById(R.id.widget_image).getVisibility());
        note.remove("sections");
        factory.onDataSetChanged();
        assertEquals(1, factory.getCount());
        View legacy = factory.getViewAt(0).apply(context, null);
        assertEquals(
                "Preview", ((TextView) legacy.findViewById(R.id.widget_body)).getText().toString());
    }
}
