package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

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
}
