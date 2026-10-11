# Android widgets

Catch provides Quick capture, One note, and Note list widgets. Open Catch and sign
in before adding one from the launcher's widget picker. Each widget has its own
account and appearance. A list can show pinned notes, Gallery, all notes, a tag including descendants,
or a Deck column. Rounded note cards retain their colors and checklist previews.
Use the custom setup dialog to choose content and appearance; its settings button
opens the same dialog later.

Previews refresh while that account is open in Catch, including offline edits.
The last preview remains available with Catch closed. Vault notes and shared
copies never appear. Taps open Catch; checklists are read-only in the launcher.
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
and recreation behavior.

The instrumented test renders all three widgets through a real AppWidgetHost in
light and dark, then verifies visible content clears and recovers as the account
snapshot is removed and restored. It also opens the custom setup dialog, chooses
All notes and saves the configuration. This test requires API 29 or newer;
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
