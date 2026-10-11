package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.content.Context;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.RemoteViews;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class WidgetLayoutTest {
    @Test
    public void launcherCanInflateEveryLayoutAndApplySurfaceColors() {
        Context context = RuntimeEnvironment.getApplication();
        for (int layout :
                new int[] {
                    R.layout.widget_capture,
                    R.layout.widget_single,
                    R.layout.widget_list,
                    R.layout.widget_row
                }) {
            RemoteViews remote = new RemoteViews(context.getPackageName(), layout);
            if (layout != R.layout.widget_row)
                remote.setInt(R.id.widget_surface, "setColorFilter", 0xff302e29);
            View view = remote.apply(context, new FrameLayout(context));
            view.measure(
                    View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY));
            view.layout(0, 0, 320, 300);
            assertEquals(320, view.getWidth());
        }
    }

    @Test
    @Config(sdk = 36)
    @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    public void pickerPreviewsFitTheirMinimumSizes() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        float density = context.getResources().getDisplayMetrics().density;
        View capture =
                new RemoteViews(context.getPackageName(), R.layout.widget_capture)
                        .apply(context, new FrameLayout(context));
        // Exercise the declared minimum, including launchers that size by dp rather than cells.
        try (android.content.res.XmlResourceParser metadata =
                context.getResources().getXml(R.xml.widget_capture)) {
            while (metadata.next() != org.xmlpull.v1.XmlPullParser.START_TAG) {}
            android.content.res.TypedArray sizes =
                    context.obtainStyledAttributes(
                            metadata,
                            new int[] {
                                android.R.attr.minWidth,
                                android.R.attr.minHeight,
                                android.R.attr.minResizeHeight,
                                android.R.attr.targetCellWidth,
                                android.R.attr.targetCellHeight
                            });
            try {
                int height = sizes.getDimensionPixelSize(1, 0);
                assertTrue(height > 0 && height <= Math.round(56 * density));
                assertEquals(height, sizes.getDimensionPixelSize(2, 0));
                assertEquals(4, sizes.getInt(3, 0));
                assertEquals(1, sizes.getInt(4, 0));
                measure(capture, sizes.getDimensionPixelSize(0, 0), height);
            } finally {
                sizes.recycle();
            }
        }
        for (int button :
                new int[] {R.id.widget_settings, R.id.widget_compose, R.id.widget_search}) {
            assertTrue(capture.findViewById(button).getHeight() >= Math.round(48 * density));
        }
        android.widget.TextView compose = capture.findViewById(R.id.widget_compose);
        assertTrue(
                compose.getPaint().measureText(compose.getText().toString()) <= compose.getWidth());
        View list =
                new RemoteViews(context.getPackageName(), R.layout.widget_preview_list)
                        .apply(context, new FrameLayout(context));
        measure(list, Math.round(220 * density), Math.round(180 * density));
        View card = (View) list.findViewById(R.id.widget_body).getParent();
        View area = (View) card.getParent();
        assertTrue(card.getHeight() + area.getPaddingTop() <= area.getHeight());
        assertTrue(list.findViewById(R.id.widget_body).getHeight() > 0);
    }

    private static void measure(View view, int width, int height) {
        view.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);
    }

    @Test
    public void returningToDeviceAppearanceReinflatesAndDropsExplicitColors() {
        Context context = RuntimeEnvironment.getApplication();
        android.appwidget.AppWidgetHostView host = new android.appwidget.AppWidgetHostView(context);
        android.appwidget.AppWidgetProviderInfo info =
                new android.appwidget.AppWidgetProviderInfo();
        info.provider =
                new android.content.ComponentName(context, CatchWidgetProvider.Single.class);
        info.initialLayout = R.layout.widget_single;
        host.setAppWidget(1, info);
        RemoteViews forced =
                new RemoteViews(context.getPackageName(), R.layout.widget_single_custom);
        forced.setTextColor(R.id.widget_title, 0xffff0000);
        host.updateAppWidget(forced);
        assertEquals(
                0xffff0000,
                ((android.widget.TextView) host.findViewById(R.id.widget_title))
                        .getCurrentTextColor());
        RemoteViews system = new RemoteViews(context.getPackageName(), R.layout.widget_single);
        host.updateAppWidget(system);
        assertEquals(
                context.getResources().getColor(R.color.widget_ink),
                ((android.widget.TextView) host.findViewById(R.id.widget_title))
                        .getCurrentTextColor());
    }
}
