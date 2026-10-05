package org.iloni.catchnotes;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;
import java.util.TimeZone;
import org.junit.Test;

/** The same cases as packages/shared/src/reminders.test.ts, so both ends agree on instants. */
public class ReminderTimesTest {
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");
    private static final TimeZone SYDNEY = TimeZone.getTimeZone("Australia/Sydney");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    private static long utc(String wall) {
        return ReminderTimes.instant(wall, UTC);
    }

    @Test
    public void readsAWallClockTimeInItsZone() {
        assertEquals(utc("2026-10-05T13:00"), ReminderTimes.instant("2026-10-05T09:00", NEW_YORK));
        assertEquals(-1, ReminderTimes.instant("soon", NEW_YORK));
    }

    @Test
    public void movesATimeTheClocksSkipPastTheChange() {
        assertEquals(utc("2026-03-08T07:30"), ReminderTimes.instant("2026-03-08T02:30", NEW_YORK));
        assertEquals(utc("2026-10-03T16:30"), ReminderTimes.instant("2026-10-04T02:30", SYDNEY));
    }

    @Test
    public void takesTheFirstOfATimeTheClocksShowTwice() {
        assertEquals(utc("2026-11-01T05:30"), ReminderTimes.instant("2026-11-01T01:30", NEW_YORK));
    }

    @Test
    public void findsTheNextTimeAfterTheLastOneRung() {
        java.util.List<String> times = Arrays.asList("2026-10-05T09:00", "2026-10-06T09:00");
        long first = utc("2026-10-05T13:00");
        long second = utc("2026-10-06T13:00");
        assertEquals(first, ReminderTimes.next(times, 0, NEW_YORK, first - 1));
        assertEquals(second, ReminderTimes.next(times, 0, NEW_YORK, first));
        assertEquals(-1, ReminderTimes.next(times, 0, NEW_YORK, second));
    }

    @Test
    public void ringsASnoozeBeforeTheTimesBehindIt() {
        java.util.List<String> times = Collections.singletonList("2026-10-06T09:00");
        long snooze = utc("2026-10-05T14:00");
        assertEquals(snooze, ReminderTimes.next(times, snooze, NEW_YORK, utc("2026-10-05T13:00")));
        // Once it has rung, the times carry on.
        assertEquals(utc("2026-10-06T13:00"), ReminderTimes.next(times, snooze, NEW_YORK, snooze));
        assertEquals(snooze, ReminderTimes.next(Collections.<String>emptyList(), snooze, NEW_YORK, 0));
    }

    @Test
    public void doesNotRingAWallClockTimeAgainAfterMovingWest() {
        java.util.List<String> times = Arrays.asList("2026-10-05T09:00", "2026-10-06T09:00");
        TimeZone losAngeles = TimeZone.getTimeZone("America/Los_Angeles");
        long rangInNewYork = ReminderTimes.instant("2026-10-05T09:00", NEW_YORK);
        assertEquals("2026-10-05T09:00", ReminderTimes.due(times, NEW_YORK, rangInNewYork - 1, rangInNewYork, ""));
        // By the instant alone, nine in Los Angeles is still ahead.
        assertEquals(
                ReminderTimes.instant("2026-10-05T09:00", losAngeles),
                ReminderTimes.next(times, 0, losAngeles, rangInNewYork));
        assertEquals(
                ReminderTimes.instant("2026-10-06T09:00", losAngeles),
                ReminderTimes.next(times, 0, losAngeles, rangInNewYork, "2026-10-05T09:00"));
        // A snooze is an instant and rings whatever the wall clock record says.
        assertEquals(rangInNewYork + 60_000, ReminderTimes.next(times, rangInNewYork + 60_000, losAngeles, rangInNewYork, "2026-10-05T09:00"));
        assertEquals("", ReminderTimes.due(times, NEW_YORK, rangInNewYork, rangInNewYork + 60_000, "2026-10-05T09:00"));
    }
}
