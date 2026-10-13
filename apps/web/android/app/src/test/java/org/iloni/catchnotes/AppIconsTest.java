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
    public void stableIsTheOnlyLauncherByDefault() throws Exception {
        assertTrue(manager.getActivityInfo(component("StableIcon"), 0).enabled);
        assertFalse(manager.getActivityInfo(component("PreviewIcon"), PackageManager.MATCH_DISABLED_COMPONENTS).enabled);
        assertEquals(component("StableIcon"), manager.getLaunchIntentForPackage(context.getPackageName()).getComponent());
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
    public void invalidChoicesLeaveTheLauncherAlone() {
        assertThrows(IllegalArgumentException.class, () -> AppIcons.set(context, "dev"));
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component("StableIcon")));
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, manager.getComponentEnabledSetting(component("PreviewIcon")));
    }
}
