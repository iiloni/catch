package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class AppIconsTest {
    private Context context;
    private PackageManager manager;

    @Before
    public void setup() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getPackageManager();
    }

    private ComponentName component(String name) {
        return new ComponentName(context.getPackageName(), "org.iloni.catchnotes." + name);
    }

    @Test
    public void buildDefaultIsTheOnlyLauncher() throws Exception {
        boolean dev = context.getResources().getBoolean(R.bool.default_dev_icon);
        String chosen = dev ? "DevIcon" : "StableIcon";
        String other = dev ? "StableIcon" : "DevIcon";
        assertTrue(manager.getActivityInfo(component(chosen), 0).enabled);
        assertFalse(manager.getActivityInfo(component(other), PackageManager.MATCH_DISABLED_COMPONENTS).enabled);
        assertFalse(manager.getActivityInfo(component("PreviewIcon"), PackageManager.MATCH_DISABLED_COMPONENTS).enabled);
        assertEquals(component(chosen), manager.getLaunchIntentForPackage(context.getPackageName()).getComponent());
    }

    @Test
    public void switchesBothWaysWithoutDisablingTheActivity() throws Exception {
        AppIcons.set(context, "preview");
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED, manager.getComponentEnabledSetting(component("PreviewIcon")));
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, manager.getComponentEnabledSetting(component("StableIcon")));
        assertEquals(component("PreviewIcon"), manager.getLaunchIntentForPackage(context.getPackageName()).getComponent());
        assertTrue(manager.getActivityInfo(component("MainActivity"), 0).enabled);
        Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(context.getPackageName());
        assertEquals("org.iloni.catchnotes.MainActivity", manager.resolveActivity(share, 0).activityInfo.name);

        AppIcons.set(context, "stable");
        assertEquals(component("StableIcon"), manager.getLaunchIntentForPackage(context.getPackageName()).getComponent());
        assertTrue(manager.getActivityInfo(component("MainActivity"), 0).enabled);
    }

    @Test
    public void devBuildsCanSelectDevAndReleasedBuildsCannot() throws Exception {
        if (context.getResources().getBoolean(R.bool.default_dev_icon)) {
            AppIcons.set(context, "preview");
            AppIcons.set(context, "dev");
            assertEquals(component("DevIcon"), manager.getLaunchIntentForPackage(context.getPackageName()).getComponent());
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, manager.getComponentEnabledSetting(component("StableIcon")));
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED, manager.getComponentEnabledSetting(component("PreviewIcon")));
            assertTrue(manager.getActivityInfo(component("MainActivity"), 0).enabled);
        } else {
            assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, "dev"));
        }
    }

    @Test
    public void invalidChoicesLeaveTheLauncherAlone() {
        assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, "nightly"));
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component("StableIcon")));
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component("PreviewIcon")));
    }

    @Test
    @Config(sdk = 36)
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    public void previewsRenderTheAdaptiveLauncherArtworkWithoutChangingTheChoice() throws Exception {
        String[] icons = context.getResources().getBoolean(R.bool.default_dev_icon)
                ? new String[] {"stable", "preview", "dev"} : new String[] {"stable", "preview"};
        for (String icon : icons) {
            String source = AppIcons.preview(context, icon);
            assertTrue(source.startsWith("data:image/png;base64,"));
            byte[] bytes = Base64.decode(source.substring(source.indexOf(',') + 1), Base64.DEFAULT);
            Bitmap image = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            assertNotNull(image);
            assertEquals(256, image.getWidth());
            assertEquals(256, image.getHeight());
            assertEquals(0, Color.alpha(image.getPixel(0, 0)));
            // The first motion mark belongs to the adaptive foreground, not the small favicon.
            int motionMark = image.getPixel(52, 69);
            assertTrue(Color.red(motionMark) > 230 && Color.green(motionMark) > 230 && Color.blue(motionMark) > 220);
            int background = image.getPixel(16, 128);
            assertTrue("stable".equals(icon) ? Color.red(background) > Color.blue(background)
                    : Color.blue(background) > Color.red(background));
            image.recycle();
        }
        for (String alias : new String[] {"StableIcon", "PreviewIcon", "DevIcon"}) {
            assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component(alias)));
        }
    }
}
