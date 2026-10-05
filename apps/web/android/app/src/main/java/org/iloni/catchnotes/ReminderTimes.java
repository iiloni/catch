package org.iloni.catchnotes;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.TimeZone;

/**
 * When a reminder's wall clock times fall, as instants. The server and the web app work this
 * out in TypeScript (packages/shared/src/reminders.ts); this is the same reading of a time
 * the clocks skip or show twice, so the phone rings when they say it will.
 */
final class ReminderTimes {
    /** A reminder missed by more than this (the phone was off) is not rung late. */
    static final long LATE_MS = 24L * 60 * 60 * 1000;

    private ReminderTimes() {}

    private static Calendar calendar(TimeZone zone, long instant) {
        Calendar calendar = new GregorianCalendar(zone);
        calendar.setTimeInMillis(instant);
        return calendar;
    }

    private static boolean shows(TimeZone zone, long instant, int[] wall) {
        Calendar calendar = calendar(zone, instant);
        return calendar.get(Calendar.YEAR) == wall[0] && calendar.get(Calendar.MONTH) == wall[1] - 1
                && calendar.get(Calendar.DAY_OF_MONTH) == wall[2] && calendar.get(Calendar.HOUR_OF_DAY) == wall[3]
                && calendar.get(Calendar.MINUTE) == wall[4];
    }

    /** The instant of `YYYY-MM-DDTHH:MM` in a zone, or -1 for text that is not one. */
    static long instant(String wall, TimeZone zone) {
        if (wall == null || !wall.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}")) return -1;
        int[] parts = {
            Integer.parseInt(wall.substring(0, 4)), Integer.parseInt(wall.substring(5, 7)),
            Integer.parseInt(wall.substring(8, 10)), Integer.parseInt(wall.substring(11, 13)),
            Integer.parseInt(wall.substring(14, 16)),
        };
        Calendar calendar = new GregorianCalendar(zone);
        calendar.clear();
        // Lenient: a time the clocks skip lands as far past the change as it was into the gap.
        calendar.set(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
        long instant = calendar.getTimeInMillis();
        // A time the clocks show twice is its first showing.
        long savings = zone.getDSTSavings();
        if (savings > 0 && shows(zone, instant - savings, parts)) return instant - savings;
        return instant;
    }

    /**
     * The first instant later than `after` among a reminder's times and its snooze (0 for
     * none), or -1 when there is none.
     */
    static long next(List<String> times, long snoozedUntil, TimeZone zone, long after) {
        return next(times, snoozedUntil, zone, after, "");
    }

    /**
     * As above, leaving out the times up to `rungWall`, the wall clock time that last rang.
     * An instant alone does not say a time has rung: carried west, the same wall clock time
     * comes round again later.
     */
    static long next(List<String> times, long snoozedUntil, TimeZone zone, long after, String rungWall) {
        long next = snoozedUntil > after ? snoozedUntil : -1;
        for (String time : times) {
            if (time.compareTo(rungWall) <= 0) continue;
            long instant = instant(time, zone);
            if (instant <= after) continue;
            if (next < 0 || instant < next) next = instant;
            // Times come soonest first, but one near a clock change can be out of order.
        }
        return next;
    }

    /** The latest of the times that came due in (after, now], or "" when it was the snooze. */
    static String due(List<String> times, TimeZone zone, long after, long now, String rungWall) {
        String due = "";
        for (String time : times) {
            if (time.compareTo(rungWall) <= 0) continue;
            long instant = instant(time, zone);
            if (instant > after && instant <= now && time.compareTo(due) > 0) due = time;
        }
        return due;
    }
}
