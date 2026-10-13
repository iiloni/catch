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
    public void offlineRefreshKeepsOnlyTheSameNotesCurrentImageSource() throws Exception {
        JSONObject photo = WidgetStore.array(snapshot, "notes").getJSONObject(0);
        photo.put("imageKey", "link:hash").put("image", "YWJj");
        WidgetStore.sync(context, session, snapshot);
        JSONObject refresh = new JSONObject(snapshot.toString());
        JSONObject incoming = refresh.getJSONArray("notes").getJSONObject(0);
        incoming.remove("image");
        incoming.put("body", "Offline edit");
        assertTrue(WidgetStore.sync(context, session, refresh));
        assertEquals("YWJj", incoming.optString("image"));
        refresh = new JSONObject(refresh.toString());
        incoming = refresh.getJSONArray("notes").getJSONObject(0);
        incoming.remove("image");
        incoming.put("imageKey", "attachment:replacement");
        WidgetStore.sync(context, session, refresh);
        assertFalse(incoming.has("image"));
        incoming.put("image", "YWJj");
        WidgetStore.sync(context, session, refresh);
        JSONObject removed = new JSONObject(refresh.toString());
        removed.getJSONArray("notes").getJSONObject(0).remove("image");
        removed.getJSONArray("notes").getJSONObject(0).remove("imageKey");
        WidgetStore.sync(context, session, removed);
        assertFalse(removed.getJSONArray("notes").getJSONObject(0).has("image"));
        String bob =
                WidgetStore.begin(
                        context,
                        "bob",
                        "https://catch.example",
                        new JSONArray("[{id:'alice'},{id:'bob'}]"));
        JSONObject other = new JSONObject(snapshot.toString());
        other.getJSONArray("notes").getJSONObject(0).remove("image");
        WidgetStore.sync(context, bob, other);
        assertFalse(other.getJSONArray("notes").getJSONObject(0).has("image"));
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
    public void switchingServersRetainsEachWidgetsSnapshotAndLaunchOrigin() throws Exception {
        JSONArray accounts = new JSONArray("[{id:'alice',label:'Alice',server:'https://catch.example'},{id:'work',label:'Alice',server:'https://work.example'}]");
        String work = WidgetStore.begin(context, "work", "https://work.example", accounts);
        JSONObject clone = new JSONObject(snapshot.toString());
        clone.getJSONArray("notes").getJSONObject(0).put("title", "Work shopping");
        assertTrue(WidgetStore.sync(context, work, clone));
        assertEquals("Shopping", WidgetStore.notes(WidgetStore.snapshot(context, config), config).get(0).getString("title"));
        assertEquals("https://catch.example", WidgetStore.launch(context, 42, "note", "one").getString("server"));
        JSONObject workConfig = new JSONObject(config.toString()).put("account", "work");
        WidgetStore.configure(context, 43, workConfig);
        assertEquals("https://work.example", WidgetStore.launch(context, 43, "note", "one").getString("server"));
        WidgetStore.begin(context, "alice", "https://catch.example", accounts);
        assertEquals("Work shopping", WidgetStore.notes(WidgetStore.snapshot(context, workConfig), workConfig).get(0).getString("title"));
        WidgetStore.clear(context, "alice");
        assertEquals(0, WidgetStore.account(context, "alice").length());
        assertEquals("work", WidgetStore.launch(context, 43, "note", "one").getString("account"));
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
