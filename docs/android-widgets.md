# Android widgets

Catch provides Quick capture, One note, and Note list widgets. Open Catch and sign
in before adding one from the launcher's widget picker. Each widget has its own
account and appearance. A list can show pinned notes, Gallery, all notes, a tag including descendants,
or a Deck column. Rounded note cards retain their colors and checklist previews.
The list dedicates its space to cards with a floating New note button, without
header or footer bars, and its + button has the same rounded-square shape as Catch's
other controls. One note scrolls through the full note text. Both note widgets can
show one image: the first image attachment, or a visible link preview thumbnail
when no attached image is available. Hidden or disabled link previews stay hidden.
Images are cached with the widget so they remain visible offline.
Use the custom setup dialog to choose content and appearance.
To change a placed list, touch and hold it and choose the launcher's Edit/Reconfigure
option. On older launchers without this action, remove and add it again. Quick capture
and One note keep their settings buttons.

Previews refresh while that account is open in Catch, including offline edits.
The last preview remains available with Catch closed. Vault notes and shared
copies never appear. Buttons and cards show ripple feedback when pressed. A note opens directly in
Catch without briefly showing Gallery or Deck. Tapping another note switches the
editor automatically and saves the previous note or composer first. Account switches
wait for those edits to reach device storage. Checklists are read-only in the launcher.
New note and Search focus their input and request the Android keyboard after a
fresh launch as well as while Catch is already running.
New notes from a Deck-column list start in that column; other widgets create
Gallery notes without automatically adding tags or pins.

The implementation and storage boundary are described in
[ADR 0022](decisions/0022-android-widgets.md).

## Native validation

With the Android SDK installed and `ANDROID_HOME` set, build and check native
code from the checkout:

```sh
apps/web/android/gradlew -p apps/web/android \
  :app:assembleDevDebug :app:testDevDebugUnitTest :app:lintDevDebug
```

Robolectric exercises the minimum API 24 and API 36: snapshot recovery after
process death, account removal, stale sessions, launch validation, RemoteViews
inflation, resetting an explicit appearance to the device theme and clearing
visible content after sign-out, Gallery/all-notes filters and setup save/cancel
and recreation behavior. API 28 and 36 use real bitmap decoding to check thumbnail
size limits, invalid images and clearing recycled image rows. Tests also cover full
single-note sections, older text-only snapshots and retaining only the current
image source during an offline refresh.

The instrumented test renders all three widgets through a real AppWidgetHost in
light and dark, then verifies visible content clears and recovers as the account
snapshot is removed and restored. It verifies the last list card scrolls above the
floating New note button and that launcher reconfiguration remains registered.
It holds touches on capture buttons, the single note, list cards and the floating
New note button, comparing painted window pixels to verify ripple feedback in both themes.
It verifies an image in the single-note widget and swipes through a long note to its
last line. It also opens the custom setup dialog, chooses All notes and saves the configuration.
This test requires API 29 or newer;
Robolectric covers the minimum API separately. **Run it only on a disposable emulator**: it
replaces the target app’s widget snapshot with fixture notes. Set `ANDROID_SERIAL` to that emulator
so a connected personal phone is not selected:

```sh
ANDROID_SERIAL=emulator-5580 apps/web/android/gradlew -p apps/web/android \
  :app:connectedDevDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=org.iloni.catchnotes.WidgetsInstrumentedTest
```

It saves `widgets-light.png` and `widgets-dark.png` under the Catch Dev app's
external files directory, along with `widget-setup.png`. Captures copy only the
test app's painted windows. Launcher-specific resizing, large fonts and
cold/warm tap flows still need manual verification on a phone.

For phone verification, build a fresh test APK with a separate application ID
and remove it afterward. Never run the fixture test against an existing Catch
install. The screenshots below were captured this way on Android API 37. They show real RemoteViews with fixture notes, not web mockups.

[Light appearance](screenshots/android-widgets-light.png) ·
[Dark appearance](screenshots/android-widgets-dark.png)

[Custom setup](screenshots/android-widget-setup.png)

[Pressed note card](screenshots/android-widget-pressed.png)

[Long single note, scrolled to its last line](screenshots/android-widget-scrolled.png)

`./scripts/dev.sh e2e e2e/widgets.spec.ts --workers=1` exercises cold routing,
editor replacement with pending keystrokes, automatic composer saving and capture
from an open editor, and Search handoff with duplicate delivery and a delayed
Back traversal. These tests use the real editor and outbox with the native
launch bridge mocked, and save painted startup/editor frames. Run the same cases
with `E2E_FIREFOX=1` and `--project=firefox` for desktop Firefox coverage.
The image case exercises real canvas JPEG encoding for attachment and link
thumbnails, bounds their dimensions and payload, and reloads before reading an
attachment thumbnail offline.

`WidgetInputInstrumentedTest` exercises the real bundled React app, native widget
launches and visible IME in fresh Activities. Build with `CATCH_DEV_SERVER_URL`
pointing to this worktree's dev server and pass the same URL as the instrumentation
`server` argument. It creates a fixture account on that server; use a disposable
emulator or a separate application ID as above. For example:

```sh
ANDROID_SERIAL=emulator-5580 apps/web/android/gradlew -p apps/web/android \
  :app:connectedDevDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=org.iloni.catchnotes.WidgetInputInstrumentedTest \
  -Pandroid.testInstrumentationRunnerArguments.server=http://10.0.2.2:26268
```

The test checks capture New note/Search and list New note, plus typing into each
focused field. For isolated process-death testing, `keepFixtures=true` retains its
test widget IDs in `widget-input-fixtures.json` under the app's external files
directory; remove the test app afterward. The default run deletes its widget host.
