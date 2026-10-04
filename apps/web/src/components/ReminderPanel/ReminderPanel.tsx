import {
  firstPending,
  type Note,
  type Recurrence,
  type Reminder,
  remainingCount,
  reminderFireTime,
  reminderZone,
} from '@catch/shared';
import {
  Bell,
  CalendarDays,
  Clock,
  Globe,
  type LucideIcon,
  Minus,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import {
  defaultReminderStart,
  describeRecurrence,
  deviceLocalTime,
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

const shortDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function initialForm(reminder: Reminder | undefined, fallback: string): Form {
  const startsAt = reminder?.nextAt ?? fallback;
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

const inputClass =
  'h-11 rounded-xl border-transparent bg-foreground/[0.06] px-3 text-base shadow-none md:text-base';

/** One step of setting a reminder, with what it is set to shown beside its name. */
function Step({
  icon: Icon,
  title,
  value,
  children,
}: {
  icon: LucideIcon;
  title: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-2xl bg-foreground/[0.04] p-2">
      <legend className="sr-only">{title}</legend>
      <div aria-hidden className="flex items-center gap-1.5 px-1 pb-2 text-xs">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="ml-auto min-w-0 truncate font-medium">{value}</span>
      </div>
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
        'flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl px-1 py-1 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-40',
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
    'flex size-9 items-center justify-center rounded-lg outline-none hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-40';
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
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-[0.6875rem] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

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
  const [times] = useReminderTimes();
  const [now, setNow] = useState(() => new Date());
  const [opened] = useState(() => initialForm(reminder, defaultReminderStart(now, times)));
  const [form, setForm] = useState(opened);
  const days = quickReminderDays(now);
  const presets = quickReminderTimes(times);
  // Until the user asks for a field, a day or time that matches a choice shows as that choice.
  const [pickingDate, setPickingDate] = useState(() => !days.some((day) => day.date === form.date));
  const [pickingTime, setPickingTime] = useState(
    () => !presets.some((preset) => preset.time === form.time),
  );
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
  const nowTime = deviceLocalTime(now).slice(11);
  const rang =
    reminder?.firedAt && now.getTime() - reminder.firedAt.getTime() < 24 * 60 * 60 * 1000;
  const summary = !input
    ? 'Choose a day and a time'
    : passed
      ? 'That time has passed'
      : rings
        ? `${formatReminderTime(rings, now)}${
            input.recurrence ? ` · ${describeRecurrence(input.recurrence)}` : ''
          }`
        : 'Nothing left to ring for';

  return (
    <form
      aria-label="Reminder"
      className={cn(
        'flex max-h-[min(34rem,calc(100dvh-var(--dock-bottom)-var(--dock-height)-var(--safe-top)-5rem))] flex-col gap-1.5 px-2 pt-2 pb-1',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (!input || passed || !rings) return;
        // A pending reminder opens on its next time, not its first. Saved untouched it stays
        // as it is.
        if (reminder?.nextAt && JSON.stringify(input) === JSON.stringify(toInput(opened))) {
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
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-destructive outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-1.5 overflow-y-auto rounded-2xl [scrollbar-width:none] [&>*]:shrink-0">
        {rang && reminder && (
          <Button
            type="button"
            variant="secondary"
            className="h-11 shrink-0 rounded-xl"
            onClick={() => {
              haptics.success();
              snoozeReminder(note.id, new Date(Date.now() + 60 * 60 * 1000));
              onDone();
            }}
          >
            Remind me again in an hour
          </Button>
        )}

        <Step icon={CalendarDays} title="Day" value={date ? shortDate.format(date) : undefined}>
          <div className="grid grid-cols-4 gap-1.5">
            {days.map((day) => (
              <Choice
                key={day.label}
                label={day.label}
                selected={!pickingDate && form.date === day.date}
                onSelect={() => {
                  setPickingDate(false);
                  update({ date: day.date });
                }}
              />
            ))}
            <Choice
              label="Pick a date"
              selected={pickingDate}
              onSelect={() => setPickingDate(true)}
            />
          </div>
          <AnimatedHeight anchor="top">
            {pickingDate && (
              <Input
                type="date"
                aria-label="Date"
                required
                value={form.date}
                onChange={(event) => update({ date: event.target.value })}
                className={cn(inputClass, 'mt-1.5')}
              />
            )}
          </AnimatedHeight>
        </Step>

        <Step icon={Clock} title="Time" value={input ? formatTimeOfDay(form.time) : undefined}>
          <div className="grid grid-cols-4 gap-1.5">
            {presets.map((preset) => (
              <Choice
                key={preset.label}
                label={preset.label}
                detail={formatTimeOfDay(preset.time)}
                selected={!pickingTime && form.time === preset.time}
                disabled={form.repeat === 'none' && form.date === today && preset.time <= nowTime}
                onSelect={() => {
                  setPickingTime(false);
                  update({ time: preset.time });
                }}
              />
            ))}
            <Choice label="Custom" selected={pickingTime} onSelect={() => setPickingTime(true)} />
          </div>
          <AnimatedHeight anchor="top">
            {pickingTime && (
              <Input
                type="time"
                aria-label="Time"
                required
                value={form.time}
                onChange={(event) => update({ time: event.target.value })}
                className={cn(inputClass, 'mt-1.5')}
              />
            )}
          </AnimatedHeight>
        </Step>

        <Step
          icon={Repeat}
          title="Repeat"
          value={input?.recurrence ? describeRecurrence(input.recurrence) : 'Does not repeat'}
        >
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
              // The rail marks these as belonging to the repeat chosen above.
              <div className="mt-2 ml-1.5 flex flex-col gap-2.5 border-foreground/10 border-l-2 pl-2.5">
                <Detail label="Every">
                  <Stepper
                    label="Repeat every"
                    value={form.interval}
                    min={1}
                    max={99}
                    unit={form.interval === 1 ? UNITS[form.repeat] : `${UNITS[form.repeat]}s`}
                    onChange={(interval) => update({ interval })}
                  />
                </Detail>
                {form.repeat === 'weekly' && (
                  <Detail label="On">
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAYS.map((name, index) => {
                        // With none chosen it repeats on the start date's weekday.
                        const current = form.weekdays.length > 0 ? form.weekdays : [weekday];
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
                              'flex h-11 items-center justify-center rounded-full font-medium text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
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
                    <Input
                      type="date"
                      aria-label="Last day"
                      min={form.date}
                      value={form.until}
                      onChange={(event) => update({ until: event.target.value })}
                      className={inputClass}
                    />
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
        </Step>

        <div className="flex min-h-11 shrink-0 items-center gap-2 rounded-2xl bg-foreground/[0.04] py-1.5 pr-2 pl-3">
          <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-xs">
              Keep in {form.timeZone.replaceAll('_', ' ')} time
            </p>
            <p className="truncate text-[0.6875rem] text-muted-foreground">
              {form.fixed ? 'Rings at this time there' : 'Off: follows your clock when you travel'}
            </p>
          </div>
          <Switch
            aria-label="Keep in this time zone"
            checked={form.fixed}
            onCheckedChange={(fixed) => {
              haptics.toggle();
              update({ fixed });
            }}
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={!input || passed || !rings}
        className="h-11 shrink-0 rounded-xl"
      >
        {reminder ? 'Save reminder' : 'Set reminder'}
      </Button>
    </form>
  );
}
