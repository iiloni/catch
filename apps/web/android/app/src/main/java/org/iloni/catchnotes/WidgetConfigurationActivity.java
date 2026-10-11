package org.iloni.catchnotes;

import android.app.Activity;
import android.app.Dialog;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** The launcher waits for RESULT_OK; cancelling never changes the existing widget. */
public class WidgetConfigurationActivity extends AppCompatActivity {
    private static final List<String> FILTER_IDS =
            Arrays.asList("pinned", "gallery", "all", "tag", "column");
    private static final List<String> FILTER_LABELS =
            Arrays.asList("Pinned notes", "Gallery", "All notes", "Tag", "Deck column");
    private static final List<String> THEME_IDS = Arrays.asList("system", "light", "dark");
    private int widgetId;
    private String kind;
    private String accountId;
    private String filter;
    private String target;
    private String theme;
    private LinearLayout form;
    private TextView accountButton;
    private TextView filterButton;
    private TextView choiceButton;
    private TextView save;
    private final List<String> accountIds = new ArrayList<>();
    private final List<String> accountLabels = new ArrayList<>();
    private final List<String> choiceIds = new ArrayList<>();
    private final List<String> choiceLabels = new ArrayList<>();
    private final List<TextView> themeButtons = new ArrayList<>();
    private int ink;
    private int muted;
    private int surface;
    private int control;
    private static final int AMBER = 0xffffc247;

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
        JSONObject previous = WidgetStore.config(this, widgetId);
        if (state != null && state.containsKey("configuration")) {
            try {
                previous = new JSONObject(state.getString("configuration"));
            } catch (org.json.JSONException ignored) {
            }
        }
        ink = getColor(R.color.widget_ink);
        muted = getColor(R.color.widget_muted);
        surface = getColor(R.color.widget_surface_default);
        control = getColor(R.color.widget_control);
        filter = previous.optString("filter", "pinned");
        if (!FILTER_IDS.contains(filter)) filter = "pinned";
        theme = previous.optString("theme", "system");
        if (!THEME_IDS.contains(theme)) theme = "system";
        target = previous.optString("target");
        JSONObject all = WidgetStore.object(WidgetStore.state(this), "accounts");
        for (java.util.Iterator<String> ids = all.keys(); ids.hasNext(); ) {
            String id = ids.next();
            accountIds.add(id);
            accountLabels.add(WidgetStore.object(all, id).optString("label"));
        }
        accountId =
                accountIds.contains(previous.optString("account"))
                        ? previous.optString("account")
                        : accountIds.isEmpty() ? "" : accountIds.get(0);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackground(shape(surface, 28));
        scroll.setClipToOutline(true);
        form = column();
        form.setPadding(dp(24), dp(24), dp(24), dp(16));
        scroll.addView(form);
        setContentView(scroll);
        TextView brand = text("CATCH  /  HOME SCREEN", 11, muted);
        brand.setLetterSpacing(0.12f);
        add(brand, 0, 12);
        TextView title =
                text(
                        "capture".equals(kind)
                                ? "Quick capture"
                                : "single".equals(kind) ? "One note" : "Note list",
                        28,
                        ink);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        ViewCompat.setAccessibilityHeading(title, true);
        add(title, 0, 8);
        add(text("A little Catch, right at home.", 15, muted), 0, 24);
        if (accountIds.isEmpty()) {
            add(text("Open Catch and sign in to set up your widget.", 16, ink), 0, 20);
            TextView open = action("Open Catch", true);
            add(open, 0, 0);
            open.setOnClickListener(
                    view -> {
                        startActivity(new Intent(this, MainActivity.class));
                        finish();
                    });
            return;
        }
        accountButton = selector("Account");
        accountButton.setOnClickListener(
                view ->
                        pick(
                                "Account",
                                accountLabels,
                                accountIds.indexOf(accountId),
                                position -> {
                                    accountId = accountIds.get(position);
                                    target = "";
                                    populateChoices();
                                }));
        if ("list".equals(kind)) {
            filterButton = selector("Show");
            filterButton.setOnClickListener(
                    view ->
                            pick(
                                    "Show",
                                    FILTER_LABELS,
                                    FILTER_IDS.indexOf(filter),
                                    position -> {
                                        filter = FILTER_IDS.get(position);
                                        target = "";
                                        populateChoices();
                                    }));
        }
        if (!"capture".equals(kind)) {
            choiceButton = selector("single".equals(kind) ? "Note" : "Selection");
            choiceButton.setOnClickListener(
                    view ->
                            pick(
                                    "single".equals(kind)
                                            ? "Note"
                                            : "tag".equals(filter) ? "Tag" : "Deck column",
                                    choiceLabels,
                                    choiceIds.indexOf(target),
                                    position -> {
                                        target = choiceIds.get(position);
                                        refresh();
                                    }));
        }
        add(text("Appearance", 13, muted), 12, 8);
        LinearLayout appearance = new LinearLayout(this);
        String[] themeLabels = {"Device", "Light", "Dark"};
        for (int i = 0; i < themeLabels.length; i++) {
            final String value = THEME_IDS.get(i);
            TextView button = action(themeLabels[i], false);
            button.setTextSize(14);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
            if (i > 0) params.leftMargin = dp(8);
            appearance.addView(button, params);
            button.setOnClickListener(
                    view -> {
                        theme = value;
                        refresh();
                    });
            themeButtons.add(button);
        }
        add(appearance, 0, 18);
        add(
                text(
                        "Your notes stay available offline. Previews update when you open this"
                                + " account in Catch. Vault and shared notes stay in the app.",
                        12,
                        muted),
                0,
                18);
        if ("list".equals(kind))
            add(text("New notes go to Gallery or your selected Deck column.", 12, muted), 0, 18);
        save = action("Save widget", true);
        save.setOnClickListener(view -> finishConfiguration());
        add(save, 0, 4);
        TextView cancel = action("Cancel", false);
        cancel.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        cancel.setOnClickListener(view -> finish());
        add(cancel, 0, 0);
        populateChoices();
    }

    @Override
    protected void onStart() {
        super.onStart();
        getWindow().setLayout(dialogWidth(), android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dialogWidth() {
        return Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(440));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout column() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        return view;
    }

    private GradientDrawable shape(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private void add(View view, int top, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(top);
        params.bottomMargin = dp(bottom);
        form.addView(view, params);
    }

    private TextView action(String value, boolean primary) {
        TextView button = text(value, 16, primary ? 0xff302e29 : ink);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(primary ? 56 : 48));
        button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setBackground(
                new RippleDrawable(
                        ColorStateList.valueOf(0x22716b60),
                        shape(primary ? AMBER : control, 16),
                        null));
        button.setFocusable(true);
        ViewCompat.setAccessibilityDelegate(
                button,
                new androidx.core.view.AccessibilityDelegateCompat() {
                    @Override
                    public void onInitializeAccessibilityNodeInfo(
                            View view,
                            androidx.core.view.accessibility.AccessibilityNodeInfoCompat info) {
                        super.onInitializeAccessibilityNodeInfo(view, info);
                        info.setClassName(android.widget.Button.class.getName());
                    }
                });
        return button;
    }

    private TextView selector(String label) {
        TextView button = action("", false);
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setMinHeight(dp(64));
        button.setTag(label);
        add(button, 0, 10);
        return button;
    }

    private void selection(TextView button, String label, String value) {
        android.text.SpannableString content =
                new android.text.SpannableString(label + "\n" + value + "  ›");
        content.setSpan(new android.text.style.AbsoluteSizeSpan(12, true), 0, label.length(), 0);
        content.setSpan(new android.text.style.ForegroundColorSpan(muted), 0, label.length(), 0);
        button.setText(content);
        button.setContentDescription(label + ": " + value);
    }

    private interface Selected {
        void select(int position);
    }

    private void pick(String title, List<String> labels, int selected, Selected callback) {
        if (labels.isEmpty()) return;
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout panel = column();
        panel.setPadding(dp(20), dp(20), dp(20), dp(12));
        panel.setBackground(shape(surface, 24));
        TextView heading = text(title, 22, ink);
        heading.setPadding(dp(4), 0, 0, dp(16));
        ViewCompat.setAccessibilityHeading(heading, true);
        panel.addView(heading);
        android.widget.ListView options = new android.widget.ListView(this);
        options.setDivider(
                new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        options.setDividerHeight(dp(6));
        options.setAdapter(
                new android.widget.BaseAdapter() {
                    @Override
                    public int getCount() {
                        return labels.size();
                    }

                    @Override
                    public String getItem(int position) {
                        return labels.get(position);
                    }

                    @Override
                    public long getItemId(int position) {
                        return position;
                    }

                    @Override
                    public View getView(
                            int position, View recycled, android.view.ViewGroup parent) {
                        boolean chosen = position == selected;
                        TextView option =
                                recycled instanceof TextView
                                        ? (TextView) recycled
                                        : action("", false);
                        option.setText(labels.get(position) + (chosen ? "  ✓" : ""));
                        option.setTextColor(chosen ? 0xff302e29 : ink);
                        option.setBackground(
                                new RippleDrawable(
                                        ColorStateList.valueOf(0x22716b60),
                                        shape(chosen ? AMBER : control, 16),
                                        null));
                        option.setGravity(Gravity.CENTER_VERTICAL);
                        option.setMinHeight(dp(56));
                        option.setOnClickListener(
                                view -> {
                                    callback.select(position);
                                    dialog.dismiss();
                                });
                        return option;
                    }
                });
        // Recycle rows and bound the picker to half the screen, even for large accounts.
        panel.addView(
                options,
                new LinearLayout.LayoutParams(
                        -1,
                        (int)
                                Math.min(
                                        (long) dp(62) * labels.size(),
                                        getResources().getDisplayMetrics().heightPixels / 2)));
        TextView cancel = action("Cancel", false);
        cancel.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        cancel.setOnClickListener(view -> dialog.dismiss());
        panel.addView(cancel);
        dialog.setContentView(panel);
        dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        dialog.show();
        dialog.getWindow().setLayout(dialogWidth(), -2);
    }

    private boolean needsChoice() {
        return "single".equals(kind)
                || "list".equals(kind) && ("tag".equals(filter) || "column".equals(filter));
    }

    private void populateChoices() {
        choiceIds.clear();
        choiceLabels.clear();
        if (needsChoice()) {
            JSONObject snapshot =
                    WidgetStore.object(WidgetStore.account(this, accountId), "snapshot");
            JSONArray entries =
                    WidgetStore.array(
                            snapshot,
                            "single".equals(kind)
                                    ? "notes"
                                    : "tag".equals(filter) ? "tags" : "columns");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject entry = entries.optJSONObject(i);
                if (entry == null) continue;
                choiceIds.add(entry.optString("id"));
                choiceLabels.add(entry.optString("single".equals(kind) ? "title" : "name"));
            }
            if (!choiceIds.contains(target)) target = choiceIds.isEmpty() ? "" : choiceIds.get(0);
        } else target = "";
        refresh();
    }

    private void refresh() {
        selection(accountButton, "Account", accountLabels.get(accountIds.indexOf(accountId)));
        if (filterButton != null)
            selection(filterButton, "Show", FILTER_LABELS.get(FILTER_IDS.indexOf(filter)));
        if (choiceButton != null) {
            choiceButton.setVisibility(needsChoice() ? View.VISIBLE : View.GONE);
            choiceButton.setEnabled(!choiceIds.isEmpty());
            selection(
                    choiceButton,
                    "single".equals(kind) ? "Note" : "tag".equals(filter) ? "Tag" : "Deck column",
                    choiceIds.isEmpty()
                            ? "Open this account in Catch to load choices"
                            : choiceLabels.get(choiceIds.indexOf(target)));
        }
        for (int i = 0; i < themeButtons.size(); i++) {
            TextView button = themeButtons.get(i);
            boolean selected = THEME_IDS.get(i).equals(theme);
            button.setSelected(selected);
            button.setTextColor(selected ? 0xff302e29 : ink);
            button.setBackground(
                    new RippleDrawable(
                            ColorStateList.valueOf(0x22716b60),
                            shape(selected ? AMBER : control, 14),
                            null));
        }
        save.setEnabled(!needsChoice() || !choiceIds.isEmpty());
        save.setAlpha(save.isEnabled() ? 1f : 0.45f);
    }

    private JSONObject draft() {
        JSONObject config = new JSONObject();
        WidgetStore.put(config, "account", accountId);
        WidgetStore.put(config, "kind", kind);
        WidgetStore.put(config, "filter", filter);
        WidgetStore.put(config, "target", target);
        WidgetStore.put(config, "theme", theme);
        return config;
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("configuration", draft().toString());
    }

    private void finishConfiguration() {
        if (WidgetStore.account(this, accountId).length() == 0
                || needsChoice() && !choiceIds.contains(target)) return;
        try {
            WidgetStore.configure(this, widgetId, draft());
            CatchWidgetProvider.update(this, widgetId);
        } catch (RuntimeException error) {
            android.widget.Toast.makeText(
                            this,
                            "Widget could not be saved. Try again.",
                            android.widget.Toast.LENGTH_LONG)
                    .show();
            return;
        }
        setResult(
                Activity.RESULT_OK,
                new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }
}
