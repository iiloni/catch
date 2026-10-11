package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class WidgetStoreTest {
    private Context context;
    private String session;
    private JSONObject snapshot;
    private JSONObject config;

    @Before
    public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        WidgetStore.clear(context, null);
        session =
                WidgetStore.begin(
                        context,
                        "alice",
                        "https://catch.example",
                        new JSONArray("[{id:'alice',label:'Alice'},{id:'bob',label:'Bob'}]"));
        snapshot =
                new JSONObject(
                        "{version:1,notes:[{id:'one',title:'Shopping',body:'Bread',pinned:true,column:'new',tags:['tag']},{id:'two',title:'Trip',pinned:false,column:'hold',tags:[]}],columns:[{id:'new',name:'New'}],tags:[{id:'tag',name:'Home'}]}");
        WidgetStore.sync(context, session, snapshot);
        config = new JSONObject("{account:'alice',kind:'list',filter:'pinned'}");
        WidgetStore.configure(context, 42, config);
    }

    @Test
    public void snapshotsAndConfigurationSurviveProcessDeath() throws Exception {
        JSONObject launch = WidgetStore.launch(context, 42, "note", "one");
        java.lang.reflect.Field cache = WidgetStore.class.getDeclaredField("state");
        cache.setAccessible(true);
        cache.set(null, null);
        assertEquals("alice", WidgetStore.config(context, 42).optString("account"));
        assertEquals(
                2,
                WidgetStore.array(
                                WidgetStore.snapshot(context, WidgetStore.config(context, 42)),
                                "notes")
                        .length());
        assertEquals(launch.optString("id"), WidgetStore.pending(context).optString("id"));
    }

    @Test
    public void keepsAccountsSeparateAndRejectsLateSnapshotsAfterSignOut() throws Exception {
        assertNull(WidgetStore.account(context, "bob").optJSONObject("snapshot"));
        WidgetStore.clear(context, "alice");
        assertFalse(WidgetStore.sync(context, session, snapshot));
        assertEquals(0, WidgetStore.snapshot(context, config).length());
        assertNotEquals(0, WidgetStore.account(context, "bob").length());
        assertNull(WidgetStore.launch(context, 42, "compose", null));
    }

    @Test
    public void clearingAnInactiveAccountDoesNotStopTheCurrentOne() {
        WidgetStore.clear(context, "bob");
        assertTrue(WidgetStore.sync(context, session, snapshot));
    }

    @Test
    public void aNewPageRejectsThePreviousGeneration() throws Exception {
        WidgetStore.begin(
                context,
                "bob",
                "https://catch.example",
                new JSONArray("[{id:'alice'},{id:'bob'}]"));
        assertFalse(WidgetStore.sync(context, session, snapshot));
    }

    @Test
    public void reconcilingAccountsAndChangingServersRemovesOldPreviews() throws Exception {
        WidgetStore.begin(context, "bob", "https://catch.example", new JSONArray("[{id:'bob'}]"));
        assertEquals(0, WidgetStore.account(context, "alice").length());
        WidgetStore.begin(
                context, "bob", "https://elsewhere.example", new JSONArray("[{id:'bob'}]"));
        assertEquals(0, WidgetStore.config(context, 42).length());
    }

    @Test
    public void resolvesOnlyNotesInThisWidgetsFilterAndRetainsCommandsUntilAcknowledged() {
        assertNull(WidgetStore.launch(context, 42, "note", "two"));
        JSONObject launch = WidgetStore.launch(context, 42, "note", "one");
        assertEquals("alice", launch.optString("account"));
        assertEquals("one", WidgetStore.pending(context).optString("noteId"));
        WidgetStore.acknowledge(context, "older-tap");
        assertEquals(launch.optString("id"), WidgetStore.pending(context).optString("id"));
        WidgetStore.acknowledge(context, launch.optString("id"));
        assertEquals(0, WidgetStore.pending(context).length());
    }

    @Test
    public void routesComposeToAnExistingColumnOnly() throws Exception {
        config.put("filter", "column").put("target", "new");
        assertEquals("new", WidgetStore.launch(context, 42, "compose", null).optString("column"));
        config.put("target", "deleted");
        assertNull(WidgetStore.launch(context, 42, "compose", null));
    }

    @Test
    public void galleryExcludesDeckNotesWhileAllNotesKeepsBoth() throws Exception {
        WidgetStore.array(snapshot, "notes")
                .put(new JSONObject("{id:'gallery',column:null,tags:[],pinned:false}"));
        config.put("filter", "gallery");
        assertEquals(1, WidgetStore.notes(snapshot, config).size());
        assertEquals("gallery", WidgetStore.notes(snapshot, config).get(0).optString("id"));
        assertNull(WidgetStore.launch(context, 42, "note", "one"));
        assertEquals(
                "gallery", WidgetStore.launch(context, 42, "note", "gallery").optString("noteId"));
        assertFalse(WidgetStore.launch(context, 42, "compose", null).has("column"));
        config.put("filter", "all");
        assertEquals(3, WidgetStore.notes(snapshot, config).size());
        assertEquals("one", WidgetStore.launch(context, 42, "note", "one").optString("noteId"));
    }

    @Test
    public void filtersTagsColumnsAndSingleNotes() throws Exception {
        assertEquals(1, WidgetStore.notes(snapshot, config).size());
        config.put("filter", "tag").put("target", "tag");
        assertEquals("one", WidgetStore.notes(snapshot, config).get(0).optString("id"));
        config.put("filter", "column").put("target", "hold");
        assertEquals("two", WidgetStore.notes(snapshot, config).get(0).optString("id"));
        config.put("kind", "single").put("target", "one");
        assertEquals(1, WidgetStore.notes(snapshot, config).size());
        assertNull(WidgetStore.launch(context, 42, "compose", null));
        snapshot.put("notes", new JSONArray());
        assertTrue(WidgetStore.notes(snapshot, config).isEmpty());
        assertNull(WidgetStore.launch(context, 42, "note", "one"));
    }
}
