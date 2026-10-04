import {
  firstPending,
  instantToLocal,
  type Note,
  type Recurrence,
  type Reminder,
  remainingCount,
  reminderFireTime,
  reminderZone,
} from '@catch/shared';
import { Bell, ChevronLeft, ChevronRight, Minus, Plus, Repeat, Trash2 } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { DatePicker } from '@/components/DatePicker/DatePicker';
import { TimePicker } from '@/components/TimePicker/TimePicker';
import { TimeZonePicker } from '@/components/TimeZonePicker/TimeZonePicker';
import { Button } from '@/components/ui/button';
import { useHour12 } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import {
  defaultReminderStart,
  describeRecurrence,
  deviceTimeZone,
  formatReminderTime,
  formatTimeOfDay,
  ordinalName,
  quickReminderDays,
  quickReminderTimes,
  type ReminderInput,
  removeReminder,
  setReminder,
  snoozeReminder,
  timeZoneOffset,
  useReminderTimes,
  WEEKDAYS,
} from '@/lib/reminders';
import { cn } from '@/lib/utils';

type RepeatChoice = 'none' | Recurrence['frequency'];
type MonthlyOn = 'day' | 'nth' | 'last';
type Ends = 'never' | 'until' | 'count';

type Form = {
  date: string;
  time: string;
  repeat: RepeatChoice;
  interval: number;
  weekdays: number[];
  monthlyOn: MonthlyOn;
  ends: Ends;
  until: string;
  count: number;
  /** Rings at this time in `timeZone`, wherever the user is. */
  fixed: boolean;
  timeZone: string;
};

const UNITS = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The date as the calendar has it, apart from any time zone. */
function calendarDate(date: string) {
  if (!DATE.test(date)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

const daysIn = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** When a reminder that was put off rings again, while that is still ahead. */
const snoozedUntil = (reminder: Reminder | undefined, now: Date) =>
  reminder?.snoozedUntil && reminder.snoozedUntil > now ? reminder.snoozedUntil : null;

function initialForm(reminder: Reminder | undefined, now: Date, fallback: string): Form {
  const snoozed = snoozedUntil(reminder, now);
  // A one-off that rang and was put off has only the snooze left to show.
  const startsAt =
    reminder?.nextAt ??
    (reminder && snoozed
      ? instantToLocal(snoozed, reminderZone(reminder, deviceTimeZone()))
      : fallback);
  const recurrence = reminder?.recurrence ?? null;
  const nth = recurrence?.weekdayOfMonth ?? null;
  return {
    date: startsAt.slice(0, 10),
    time: startsAt.slice(11),
    repeat: recurrence?.frequency ?? 'none',
    interval: recurrence?.interval ?? 1,
    weekdays: recurrence?.weekdays ?? [],
    monthlyOn: nth ? (nth.ordinal === -1 ? 'last' : 'nth') : 'day',
    ends: recurrence?.until ? 'until' : recurrence?.count ? 'count' : 'never',
    until: recurrence?.until ?? startsAt.slice(0, 10),
    // A pending reminder opens on its next time, so its count is what is left from there.
    count: (reminder?.nextAt ? remainingCount(reminder) : recurrence?.count) || 10,
    fixed: reminder ? !reminder.floating : false,
    timeZone: reminder && !reminder.floating ? reminder.timeZone : deviceTimeZone(),
  };
}

/** The ways a month can repeat from a date: the 30th has no "fifth Monday" to offer. */
function monthlyOptions(date: Date) {
  const day = date.getUTCDate();
  const weekday = WEEKDAYS[date.getUTCDay()];
  const options: { value: MonthlyOn; label: string }[] = [{ value: 'day', label: `Day ${day}` }];
  if (day <= 28) {
    const nth = ordinalName(Math.ceil(day / 7));
    options.push({
      value: 'nth',
      label: `${nth.charAt(0).toUpperCase()}${nth.slice(1)} ${weekday}`,
    });
  }
  if (day > daysIn(date) - 7) options.push({ value: 'last', label: `Last ${weekday}` });
  return options;
}

/** The form's monthly choice, or the nearest one its date still offers. */
function monthlyChoice(form: Form, date: Date): MonthlyOn {
  const options = monthlyOptions(date).map((option) => option.value);
  if (options.includes(form.monthlyOn)) return form.monthlyOn;
  if (form.monthlyOn === 'day') return 'day';
  return options.find((option) => option !== 'day') ?? 'day';
}

/** The reminder a form describes, or null while its date or time is not filled in. */
function toInput(form: Form): ReminderInput | null {
  const date = calendarDate(form.date);
  if (!date || !/^\d{2}:\d{2}$/.test(form.time)) return null;
  let recurrence: Recurrence | null = null;
  if (form.repeat !== 'none') {
    // An end date left empty is not a reminder that never ends.
    if (form.ends === 'until' && !calendarDate(form.until)) return null;
    const monthly = form.repeat === 'monthly' ? monthlyChoice(form, date) : 'day';
    recurrence = {
      frequency: form.repeat,
      interval: form.interval,
      weekdays: form.repeat === 'weekly' ? form.weekdays : [],
      weekdayOfMonth:
        monthly === 'day'
          ? null
          : {
              ordinal:
                monthly === 'last' ? -1 : (Math.ceil(date.getUTCDate() / 7) as 1 | 2 | 3 | 4),
              weekday: date.getUTCDay(),
            },
      until: form.ends === 'until' ? form.until : null,
      count: form.ends === 'count' ? form.count : null,
    };
  }
  return {
    startsAt: `${form.date}T${form.time}`,
    timeZone: form.timeZone,
    floating: !form.fixed,
    recurrence,
  };
}

/** One step of setting a reminder: a quiet label over its row of choices. */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="px-1 pb-1.5 font-medium text-muted-foreground text-xs">
        {title}
      </p>
      {children}
    </fieldset>
  );
}

function Choice({
  selected,
  label,
  detail,
  disabled,
  onSelect,
}: {
  selected: boolean;
  label: string;
  detail?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => {
        haptics.selection();
        onSelect();
      }}
      className={cn(
        'flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl px-1 py-1 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset disabled:opacity-40',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]',
      )}
    >
      <span className="max-w-full truncate font-medium">{label}</span>
      {detail && (
        <span className={cn('max-w-full truncate text-[0.6875rem]', !selected && 'opacity-70')}>
          {detail}
        </span>
      )}
    </button>
  );
}

/** A number set by tapping, so it does not bring up the keyboard over the dock. */
function Stepper({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const button =
    'flex size-9 items-center justify-center rounded-lg outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset disabled:opacity-40';
  return (
    <div className="flex h-11 items-center gap-1 rounded-xl bg-foreground/[0.06] px-1">
      <button
        type="button"
        aria-label={`${label}: fewer`}
        disabled={value <= min}
        onClick={() => {
          haptics.selection();
          onChange(value - 1);
        }}
        className={button}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <output aria-label={label} className="min-w-0 flex-1 truncate text-center text-sm">
        <span className="font-medium tabular-nums">{value}</span> {unit}
      </output>
      <button
        type="button"
        aria-label={`${label}: more`}
        disabled={value >= max}
        onClick={() => {
          haptics.selection();
          onChange(value + 1);
        }}
        className={button}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <p className="w-10 shrink-0 pt-3.5 text-muted-foreground text-xs">{label}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** Pages under the reminder scroll as a whole: in a popover near the screen's edge there may not be room for a calendar. */
const subPageClass = 'overflow-y-auto [scrollbar-width:none]';

const pageClass =
  'flex max-h-[calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-1.75rem)] flex-col gap-2';

type Page = 'main' | 'date' | 'time' | 'zone' | 'repeat' | 'until';
const DEPTH: Record<Page, number> = { main: 0, date: 1, time: 1, zone: 1, repeat: 1, until: 2 };

/** A deeper page comes in from the right and the one before it returns from the left. */
// Both pages share one box, so they take turns rather than cross-fade: the old one leaves
// where it stands, then the panel settles to the next one's height as that one arrives.
const pages: Variants = {
  enter: (direction: number) => ({ x: direction * 24, opacity: 0 }),
  shown: {
    x: 0,
    opacity: 1,
    transition: { x: springs.smooth, opacity: { duration: 0.3, ease: 'easeOut' } },
  },
  exit: (direction: number) => ({
    x: direction * -24,
    opacity: 0,
    transition: { duration: 0.16, ease: 'easeIn' },
  }),
};

const rowClass =
  'flex min-h-11 w-full items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 text-sm outline-none transition-colors duration-200 hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset';

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const mediumDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const REPEATS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const ENDS: { value: Ends; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After' },
];

type Props = {
  note: Pick<Note, 'id' | 'userId'>;
  reminder: Reminder | undefined;
  /** Called once the reminder is saved, removed or put off. */
  onDone: () => void;
  className?: string;
};

/**
 * Sets a note's reminder in three steps (day, time, repeat), each a row of choices with the
 * rarer settings folded under the choice that needs them. It grows out of the note's dock
 * like the palette and the tags.
 */
export function ReminderPanel({ note, reminder, onDone, className }: Props) {
  // Redraws the times below when the clock setting changes.
  useHour12();
  const [times] = useReminderTimes();
  const [now, setNow] = useState(() => new Date());
  const [opened] = useState(() => initialForm(reminder, now, defaultReminderStart(now, times)));
  const [form, setForm] = useState(opened);
  const [page, setPage] = useState<Page>('main');
  // Which way the pages slide: on to a deeper page, or back from it.
  const [direction, setDirection] = useState(1);
  // From leaving one page until the next has arrived, when the panel's height is the one
  // thing moving. On the repeat page afterwards its sections open themselves.
  const [swapping, setSwapping] = useState(false);
  const go = (next: Page) => {
    haptics.toggle();
    setSwapping(true);
    setDirection(DEPTH[next] > DEPTH[page] ? 1 : -1);
    setPage(next);
  };
  const days = quickReminderDays(now);
  const presets = quickReminderTimes(times);
  const customDate = !days.some((day) => day.date === form.date);
  const customTime = !presets.some((preset) => preset.time === form.time);
  const update = (changes: Partial<Form>) => setForm((current) => ({ ...current, ...changes }));

  const input = toInput(form);
  const date = calendarDate(form.date);
  const weekday = date?.getUTCDay() ?? 0;
  const zone = input ? reminderZone(input, deviceTimeZone()) : deviceTimeZone();
  const rings = input
    ? reminderFireTime({ nextAt: firstPending(input, zone, now), snoozedUntil: null }, zone)
    : null;
  const starts = input
    ? reminderFireTime({ nextAt: input.startsAt, snoozedUntil: null }, zone)
    : null;
  // A repeating reminder may start in the past: it rings at its next time.
  const passed =
    form.repeat === 'none' && starts !== null && starts.getTime() < now.getTime() - 60_000;
  const today = days[0]?.date;
  const rang =
    reminder?.firedAt && now.getTime() - reminder.firedAt.getTime() < 24 * 60 * 60 * 1000;
  const snoozed = snoozedUntil(reminder, now);
  // Saved as it was opened, a reminder still waiting for something is left alone.
  const untouched =
    Boolean(reminder?.nextAt || snoozed) &&
    JSON.stringify(input) === JSON.stringify(toInput(opened));
  const repeatSummary = input?.recurrence
    ? describeRecurrence(input.recurrence)
    : 'Does not repeat';
  const summary = !input
    ? 'Choose a day and a time'
    : passed
      ? 'That time has passed'
      : rings
        ? `${
            untouched && snoozed
              ? `Snoozed until ${formatReminderTime(snoozed, now)}`
              : formatReminderTime(rings, now)
          }${input.recurrence ? ` · ${describeRecurrence(input.recurrence)}` : ''}`
        : 'Nothing left to ring for';

  const untilDate = calendarDate(form.until);
  const untilLabel = untilDate ? mediumDate.format(untilDate) : 'Choose a day';
  const motionProps = {
    custom: direction,
    variants: pages,
    initial: 'enter',
    animate: 'shown',
    exit: 'exit',
    onAnimationComplete: (definition: unknown) => {
      if (definition === 'shown') setSwapping(false);
    },
  };
  // A zone's offset is the one it has when the reminder rings, not today's.
  const zoneAt = rings ?? now;
  const zoneLabel = [
    form.timeZone.slice(form.timeZone.lastIndexOf('/') + 1).replaceAll('_', ' '),
    timeZoneOffset(form.timeZone, zoneAt),
  ]
    .filter(Boolean)
    .join(', ');
  // A page under the reminder: where it came from, what it sets and what that is set to.
  const pageHeader = (title: string, value: string, from: Page) => (
    <>
      <legend className="sr-only">{title}</legend>
      <div className="flex min-h-10 shrink-0 items-center gap-1 pr-2">
        {/* The title is part of the way back, which makes it a target a thumb can find. */}
        <button
          type="button"
          aria-label="Back"
          onClick={() => go(from)}
          className="-mr-1 flex h-10 shrink-0 items-center gap-1 rounded-xl pr-3 pl-2.5 text-muted-foreground text-sm outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
        >
          <ChevronLeft className="size-5 text-foreground" aria-hidden />
          {title}
        </button>
        <p role="status" className="ml-auto min-w-0 truncate font-medium text-sm">
          {value}
        </p>
      </div>
    </>
  );

  return (
    <form
      aria-label="Reminder"
      className={cn('px-2 pt-2 pb-1')}
      onSubmit={(event) => {
        event.preventDefault();
        if (!input || passed || !rings) return;
        // A pending reminder opens on its next time, not its first, so saving it untouched
        // would move its start and drop its snooze.
        if (untouched) {
          onDone();
          return;
        }
        // The panel may have sat open past the time it shows.
        const current = new Date();
        if (firstPending(input, zone, current) === null) {
          setNow(current);
          return;
        }
        haptics.success();
        setReminder(note, input);
        onDone();
      }}
    >
      <AnimatedHeight follow={page === 'repeat' && !swapping}>
        <div className="relative">
          <AnimatePresence initial={false} mode="wait" custom={direction}>
            {page === 'main' ? (
              <motion.div key="main" {...motionProps} className={cn(pageClass, className)}>
                {/* What is being set stays in view above the steps, and the button to set it below. */}
                <div className="flex min-h-10 shrink-0 items-center gap-2 pr-1 pl-2">
                  <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p
                    role="status"
                    className={cn(
                      'min-w-0 flex-1 truncate font-medium text-sm',
                      passed && 'text-destructive',
                    )}
                  >
                    {summary}
                  </p>
                  {reminder && (
                    <button
                      type="button"
                      aria-label="Remove reminder"
                      onClick={() => {
                        haptics.warning();
                        removeReminder(note.id);
                        onDone();
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-destructive outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-2.5 overflow-y-auto rounded-xl [scrollbar-width:none] [&>*]:shrink-0">
                  <Step title="Day">
                    <div className="grid grid-cols-3 gap-1.5">
                      {days.map((day) => (
                        <Choice
                          key={day.label}
                          label={day.label}
                          selected={form.date === day.date}
                          onSelect={() => update({ date: day.date })}
                        />
                      ))}
                      <Choice
                        label="Custom"
                        detail={customDate && date ? shortDate.format(date) : undefined}
                        selected={customDate}
                        onSelect={() => go('date')}
                      />
                    </div>
                  </Step>

                  <Step title="Time">
                    <div className="grid grid-cols-4 gap-1.5">
                      {presets.map((preset) => (
                        <Choice
                          key={preset.label}
                          label={preset.label}
                          detail={formatTimeOfDay(preset.time)}
                          selected={form.time === preset.time}
                          // Passed in the zone the reminder is read in, which a fixed one
                          // may not share with this device.
                          disabled={
                            form.repeat === 'none' &&
                            firstPending(
                              { startsAt: `${form.date}T${preset.time}`, recurrence: null },
                              zone,
                              now,
                            ) === null
                          }
                          onSelect={() => update({ time: preset.time })}
                        />
                      ))}
                      <Choice
                        label="Custom"
                        detail={customTime ? formatTimeOfDay(form.time) : undefined}
                        selected={customTime}
                        onSelect={() => go('time')}
                      />
                    </div>
                  </Step>

                  {/* The busiest step has a page of its own, and here only says what it is set to. */}
                  <Step title="Repeat">
                    <button
                      type="button"
                      aria-label={`Repeat: ${repeatSummary}`}
                      onClick={() => go('repeat')}
                      className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 text-sm outline-none transition-colors duration-200 hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
                    >
                      <Repeat className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-left font-medium">
                        {repeatSummary}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </Step>

                  <Step title="Time zone">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Choice
                        label="Follow"
                        selected={!form.fixed}
                        onSelect={() => update({ fixed: false, timeZone: deviceTimeZone() })}
                      />
                      <Choice
                        label="Custom"
                        detail={form.fixed ? zoneLabel : undefined}
                        selected={form.fixed}
                        // Fixed once a zone is chosen there: going in and straight back out
                        // leaves a reminder following the user as it was.
                        onSelect={() => go('zone')}
                      />
                    </div>
                    <p className="px-1 pt-1.5 text-muted-foreground text-xs">
                      {form.fixed
                        ? 'Rings when it is this time there, wherever you are.'
                        : 'Rings at this time on your clock, wherever you are.'}
                    </p>
                  </Step>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  {/* One that has just rung can be put off without setting it again. Not one
                      already put off, which this would bring forward. */}
                  {rang && reminder && !snoozed && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-11 min-w-0 flex-1 rounded-xl"
                      onClick={() => {
                        haptics.success();
                        snoozeReminder(note.id, new Date(Date.now() + 60 * 60 * 1000));
                        onDone();
                      }}
                    >
                      Snooze (1hr)
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={!input || passed || !rings}
                    className="h-11 min-w-0 flex-1 rounded-xl"
                  >
                    Save
                  </Button>
                </div>
              </motion.div>
            ) : page === 'date' ? (
              <motion.fieldset
                key="date"
                {...motionProps}
                className={cn(pageClass, subPageClass, className)}
              >
                {pageHeader('Day', date ? fullDate.format(date) : '', 'main')}
                <DatePicker
                  value={form.date}
                  min={today}
                  today={today ?? form.date}
                  // One choice to make, so making it is also going back.
                  onChange={(value) => {
                    update({ date: value });
                    go('main');
                  }}
                  className="pb-1"
                />
              </motion.fieldset>
            ) : page === 'time' ? (
              <motion.fieldset
                key="time"
                {...motionProps}
                className={cn(pageClass, subPageClass, className)}
              >
                {pageHeader('Time', formatTimeOfDay(form.time), 'main')}
                <TimePicker
                  value={form.time}
                  onChange={(time) => update({ time })}
                  className="pb-1"
                />
              </motion.fieldset>
            ) : page === 'zone' ? (
              <motion.fieldset
                key="zone"
                {...motionProps}
                className={cn(pageClass, subPageClass, className)}
              >
                {pageHeader('Time zone', zoneLabel, 'main')}
                <TimeZonePicker
                  value={form.timeZone}
                  at={zoneAt}
                  onChange={(timeZone) => {
                    update({ fixed: true, timeZone });
                    go('main');
                  }}
                />
              </motion.fieldset>
            ) : page === 'until' ? (
              <motion.fieldset
                key="until"
                {...motionProps}
                className={cn(pageClass, subPageClass, className)}
              >
                {pageHeader('Last day', untilLabel, 'repeat')}
                <DatePicker
                  value={form.until}
                  min={form.date}
                  today={today ?? form.date}
                  onChange={(until) => {
                    update({ until });
                    go('repeat');
                  }}
                  className="pb-1"
                />
              </motion.fieldset>
            ) : (
              <motion.fieldset
                key="repeat"
                {...motionProps}
                className={cn(pageClass, subPageClass, className)}
              >
                {pageHeader('Repeat', repeatSummary, 'main')}
                <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto rounded-xl pb-1 [scrollbar-width:none]">
                  <div className="grid grid-cols-5 gap-1.5">
                    {REPEATS.map((option) => (
                      <Choice
                        key={option.value}
                        label={option.label}
                        selected={form.repeat === option.value}
                        onSelect={() => update({ repeat: option.value })}
                      />
                    ))}
                  </div>
                  <AnimatedHeight anchor="top">
                    {form.repeat !== 'none' && (
                      <div className="mt-2 flex flex-col gap-2 pl-1">
                        <Detail label="Every">
                          <Stepper
                            label="Repeat every"
                            value={form.interval}
                            min={1}
                            max={99}
                            unit={
                              form.interval === 1 ? UNITS[form.repeat] : `${UNITS[form.repeat]}s`
                            }
                            onChange={(interval) => update({ interval })}
                          />
                        </Detail>
                        {form.repeat === 'weekly' && (
                          <Detail label="On">
                            <div className="grid grid-cols-7 gap-1">
                              {WEEKDAYS.map((name, index) => {
                                // With none chosen it repeats on the start date's weekday.
                                const current =
                                  form.weekdays.length > 0 ? form.weekdays : [weekday];
                                const chosen = current.includes(index);
                                return (
                                  <button
                                    key={name}
                                    type="button"
                                    aria-label={name}
                                    aria-pressed={chosen}
                                    onClick={() => {
                                      haptics.selection();
                                      update({
                                        weekdays: chosen
                                          ? current.filter((item) => item !== index)
                                          : [...current, index],
                                      });
                                    }}
                                    className={cn(
                                      'flex h-11 items-center justify-center rounded-full font-medium text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset',
                                      chosen
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-foreground/[0.06] text-muted-foreground',
                                    )}
                                  >
                                    {name.slice(0, 2)}
                                  </button>
                                );
                              })}
                            </div>
                          </Detail>
                        )}
                        {form.repeat === 'monthly' && date && (
                          <Detail label="On">
                            <div className="grid auto-cols-fr grid-flow-col gap-1.5">
                              {monthlyOptions(date).map((option) => (
                                <Choice
                                  key={option.value}
                                  label={option.label}
                                  selected={monthlyChoice(form, date) === option.value}
                                  onSelect={() => update({ monthlyOn: option.value })}
                                />
                              ))}
                            </div>
                          </Detail>
                        )}
                        <Detail label="Ends">
                          <div className="grid grid-cols-3 gap-1.5">
                            {ENDS.map((option) => (
                              <Choice
                                key={option.value}
                                label={option.label}
                                selected={form.ends === option.value}
                                onSelect={() => update({ ends: option.value })}
                              />
                            ))}
                          </div>
                          {form.ends === 'until' && (
                            <button
                              type="button"
                              aria-label={`Last day: ${untilLabel}`}
                              onClick={() => go('until')}
                              className={rowClass}
                            >
                              <span className="min-w-0 flex-1 truncate text-left font-medium">
                                {untilLabel}
                              </span>
                              <ChevronRight
                                className="size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            </button>
                          )}
                          {form.ends === 'count' && (
                            <Stepper
                              label="Ends after"
                              value={form.count}
                              min={1}
                              max={999}
                              unit={form.count === 1 ? 'time' : 'times'}
                              onChange={(count) => update({ count })}
                            />
                          )}
                        </Detail>
                      </div>
                    )}
                  </AnimatedHeight>
                </div>
              </motion.fieldset>
            )}
          </AnimatePresence>
        </div>
      </AnimatedHeight>
    </form>
  );
}
