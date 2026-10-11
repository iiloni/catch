package org.iloni.catchnotes;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** The launcher waits for RESULT_OK; cancelling never changes the existing widget. */
public class WidgetConfigurationActivity extends AppCompatActivity {
    private int widgetId;
    private String kind;
    private JSONObject previous;
    private LinearLayout form;
    private Spinner accounts;
    private Spinner filters;
    private Spinner choices;
    private Spinner themes;
    private Button save;
    private final List<String> accountIds = new ArrayList<>();
    private final List<String> choiceIds = new ArrayList<>();
    private String choiceGroup = "";

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(Activity.RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        kind = CatchWidgetProvider.kind(this, widgetId);
        if (kind == null) {
            finish();
            return;
        }
        previous = WidgetStore.config(this, widgetId);
        if (state != null && state.containsKey("configuration")) {
            try {
                previous = new JSONObject(state.getString("configuration"));
            } catch (org.json.JSONException ignored) {
            }
        }
        ScrollView scroll = new ScrollView(this);
        form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(24), dp(24), dp(24));
        scroll.addView(form);
        setContentView(scroll);
        ViewCompat.setOnApplyWindowInsetsListener(
                scroll,
                (view, insets) -> {
                    androidx.core.graphics.Insets bars =
                            insets.getInsets(WindowInsetsCompat.Type.systemBars());
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return insets;
                });
        text(
                "capture".equals(kind)
                        ? "Quick capture"
                        : "single".equals(kind) ? "One note" : "Note list",
                28);
        text("Choose what Catch shows on your home screen.", 16);
        JSONObject all = WidgetStore.object(WidgetStore.state(this), "accounts");
        List<String> labels = new ArrayList<>();
        for (java.util.Iterator<String> ids = all.keys(); ids.hasNext(); ) {
            String id = ids.next();
            accountIds.add(id);
            labels.add(WidgetStore.object(all, id).optString("label"));
        }
        if (accountIds.isEmpty()) {
            text("Open Catch and sign in, then add the widget again.", 16);
            Button open = button("Open Catch");
            open.setOnClickListener(
                    view -> {
                        startActivity(new Intent(this, MainActivity.class));
                        finish();
                    });
            return;
        }
        accounts = spinner("Account", labels);
        if ("list".equals(kind)) {
            filters =
                    spinner(
                            "Show",
                            java.util.Arrays.asList("Pinned notes", "A tag", "A Deck column"));
            String filter = previous.optString("filter");
            filters.setSelection("tag".equals(filter) ? 1 : "column".equals(filter) ? 2 : 0);
        }
        if (!"capture".equals(kind))
            choices = spinner("single".equals(kind) ? "Note" : "List", new ArrayList<>());
        themes = spinner("Appearance", java.util.Arrays.asList("Follow device", "Light", "Dark"));
        themes.setSelection(
                "light".equals(previous.optString("theme"))
                        ? 1
                        : "dark".equals(previous.optString("theme")) ? 2 : 0);
        text(
                "Only your ordinary notes appear here. Vault and shared notes stay in Catch."
                    + " Previews refresh when this account is open in Catch; the last copy stays"
                    + " available offline.",
                14);
        if ("list".equals(kind))
            text(
                    "New notes go to Gallery, or to the selected Deck column. They are not"
                            + " automatically pinned or tagged.",
                    14);
        save = button("Save widget");
        save.setOnClickListener(view -> finishConfiguration());
        Button cancel = button("Cancel");
        cancel.setOnClickListener(view -> finish());
        AdapterView.OnItemSelectedListener changed =
                new AdapterView.OnItemSelectedListener() {
                    public void onItemSelected(
                            AdapterView<?> parent, View view, int position, long id) {
                        populateChoices();
                    }

                    public void onNothingSelected(AdapterView<?> parent) {}
                };
        int selected = accountIds.indexOf(previous.optString("account"));
        accounts.setSelection(Math.max(0, selected));
        accounts.setOnItemSelectedListener(changed);
        if (filters != null) filters.setOnItemSelectedListener(changed);
        populateChoices();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setPadding(0, dp(12), 0, dp(12));
        form.addView(view);
    }

    private Spinner spinner(String label, List<String> labels) {
        text(label, 14);
        Spinner spinner = new Spinner(this);
        spinner.setContentDescription(label);
        spinner.setMinimumHeight(dp(48));
        spinner.setAdapter(adapter(labels));
        form.addView(spinner, new LinearLayout.LayoutParams(-1, -2));
        return spinner;
    }

    private ArrayAdapter<String> adapter(List<String> labels) {
        ArrayAdapter<String> adapter =
                new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        form.addView(button, new LinearLayout.LayoutParams(-1, -2));
        return button;
    }

    private String filter() {
        return filters == null || filters.getSelectedItemPosition() == 0
                ? "pinned"
                : filters.getSelectedItemPosition() == 1 ? "tag" : "column";
    }

    private void populateChoices() {
        if (choices == null) return;
        int selection = accounts.getSelectedItemPosition();
        if (selection < 0 || selection >= accountIds.size()) return;
        JSONObject snapshot =
                WidgetStore.object(
                        WidgetStore.account(this, accountIds.get(selection)), "snapshot");
        String group = accountIds.get(selection) + ":" + filter();
        if (group.equals(choiceGroup)) return;
        choiceGroup = group;
        choiceIds.clear();
        List<String> labels = new ArrayList<>();
        String key = "single".equals(kind) ? "notes" : "tag".equals(filter()) ? "tags" : "columns";
        if ("list".equals(kind) && "pinned".equals(filter())) {
            labels.add("All pinned notes");
            choiceIds.add("");
        } else {
            JSONArray entries = WidgetStore.array(snapshot, key);
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.optJSONObject(i);
                if (entry == null) continue;
                choiceIds.add(entry.optString("id"));
                labels.add(entry.optString("single".equals(kind) ? "title" : "name"));
            }
        }
        save.setEnabled(!choiceIds.isEmpty());
        if (labels.isEmpty()) labels.add("Open this account in Catch to load choices");
        choices.setAdapter(adapter(labels));
        if (accountIds.get(selection).equals(previous.optString("account"))
                && filter().equals(previous.optString("filter", "pinned"))) {
            choices.setSelection(Math.max(0, choiceIds.indexOf(previous.optString("target"))));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (accounts == null || accounts.getSelectedItemPosition() < 0) return;
        JSONObject draft = new JSONObject();
        WidgetStore.put(draft, "account", accountIds.get(accounts.getSelectedItemPosition()));
        WidgetStore.put(draft, "filter", filter());
        int selected = choices == null ? -1 : choices.getSelectedItemPosition();
        WidgetStore.put(
                draft,
                "target",
                selected >= 0 && selected < choiceIds.size() ? choiceIds.get(selected) : "");
        WidgetStore.put(
                draft,
                "theme",
                themes.getSelectedItemPosition() == 1
                        ? "light"
                        : themes.getSelectedItemPosition() == 2 ? "dark" : "system");
        state.putString("configuration", draft.toString());
    }

    private void finishConfiguration() {
        int account = accounts.getSelectedItemPosition();
        if (account < 0 || account >= accountIds.size()) return;
        String id = accountIds.get(account);
        if (WidgetStore.account(this, id).length() == 0) {
            finish();
            return;
        }
        JSONObject config = new JSONObject();
        WidgetStore.put(config, "account", id);
        WidgetStore.put(config, "kind", kind);
        WidgetStore.put(config, "filter", filter());
        int selected = choices == null ? -1 : choices.getSelectedItemPosition();
        if (choices != null && (selected < 0 || selected >= choiceIds.size())) return;
        WidgetStore.put(config, "target", choices == null ? "" : choiceIds.get(selected));
        WidgetStore.put(
                config,
                "theme",
                themes.getSelectedItemPosition() == 1
                        ? "light"
                        : themes.getSelectedItemPosition() == 2 ? "dark" : "system");
        try {
            WidgetStore.configure(this, widgetId, config);
        } catch (RuntimeException error) {
            android.widget.Toast.makeText(
                            this,
                            "Widget could not be saved. Try again.",
                            android.widget.Toast.LENGTH_LONG)
                    .show();
            return;
        }
        CatchWidgetProvider.update(this, widgetId);
        setResult(
                Activity.RESULT_OK,
                new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }
}
