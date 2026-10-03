import { type Recurrence, type Reminder, reminderFireTime, reminderZone } from '@catch/shared';
import { type ReactNode, useId, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { notesCollection, useReminders } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import {
  deviceLocalTime,
  deviceTimeZone,
  formatReminderTime,
  formatTimeOfDay,
  ordinalName,
  quickReminderTimes,
  type ReminderInput,
  reminderSheet,
  removeReminder,
  setReminder,
  snoozeReminder,
  useReminderTimes,
  WEEKDAYS,
} from '@/lib/reminders';
import { cn } from '@/lib/utils';

type Repeat = 'none' | Recurrence['frequency'];
type MonthlyOn = 'day' | 'nth' | 'last';
type Ends = 'never' | 'until' | 'count';

type Form = {
  date: string;
  time: string;
  repeat: Repeat;
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

/** The date as the calendar has it, apart from any time zone. */
const calendarDate = (date: string) => new Date(`${date}T12:00:00Z`);

const daysIn = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

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
    count: recurrence?.count ?? 10,
    fixed: reminder ? !reminder.floating : false,
    timeZone: reminder && !reminder.floating ? reminder.timeZone : deviceTimeZone(),
  };
}

/** The reminder a form describes, or null while its date or time is not filled in. */
function toInput(form: Form): ReminderInput | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !/^\d{2}:\d{2}$/.test(form.time)) return null;
  const date = calendarDate(form.date);
  if (Number.isNaN(date.getTime())) return null;
  const weekday = date.getUTCDay();
  const day = date.getUTCDate();
  let recurrence: Recurrence | null = null;
  if (form.repeat !== 'none') {
    recurrence = {
      frequency: form.repeat,
      interval: Math.min(999, Math.max(1, Math.round(form.interval) || 1)),
      weekdays: form.repeat === 'weekly' ? form.weekdays : [],
      weekdayOfMonth:
        form.repeat === 'monthly' && form.monthlyOn !== 'day'
          ? {
              ordinal:
                form.monthlyOn === 'last' ? -1 : (Math.min(4, Math.ceil(day / 7)) as 1 | 2 | 3 | 4),
              weekday,
            }
          : null,
      until: form.ends === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(form.until) ? form.until : null,
      count:
        form.ends === 'count' ? Math.min(9999, Math.max(1, Math.round(form.count) || 1)) : null,
    };
  }
  return {
    startsAt: `${form.date}T${form.time}`,
    timeZone: form.timeZone,
    floating: !form.fixed,
    recurrence,
  };
}

const fieldClass =
  'h-11 rounded-xl border-transparent bg-foreground/[0.06] px-3 text-base shadow-none md:text-base';

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="px-1 font-medium text-muted-foreground text-xs">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Select<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        fieldClass,
        'w-full min-w-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const REPEATS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
] as const;

const ENDS = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After a number of times' },
] as const;

function ReminderForm({
  noteId,
  userId,
  reminder,
  onDone,
}: {
  noteId: string;
  userId: string;
  reminder: Reminder | undefined;
  onDone: () => void;
}) {
  const [times] = useReminderTimes();
  const [now] = useState(() => new Date());
  const quick = quickReminderTimes(now, times);
  const [form, setForm] = useState(() =>
    initialForm(reminder, quick[0]?.startsAt ?? deviceLocalTime(now)),
  );
  const update = (changes: Partial<Form>) => setForm((current) => ({ ...current, ...changes }));

  const input = toInput(form);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? calendarDate(form.date) : null;
  const validDate = date && !Number.isNaN(date.getTime()) ? date : null;
  const weekday = validDate?.getUTCDay() ?? 0;
  const day = validDate?.getUTCDate() ?? 1;
  const inLastWeek = validDate ? day > daysIn(validDate) - 7 : false;
  const startsIn = input
    ? reminderFireTime(
        { nextAt: input.startsAt, snoozedUntil: null },
        reminderZone(input, deviceTimeZone()),
      )
    : null;
  // A repeating reminder may start in the past: it rings at its next time.
  const passed =
    form.repeat === 'none' && startsIn !== null && startsIn.getTime() < now.getTime() - 60_000;
  const rang =
    reminder?.firedAt && now.getTime() - reminder.firedAt.getTime() < 24 * 60 * 60 * 1000;

  function save(value: ReminderInput) {
    haptics.success();
    setReminder({ id: noteId, userId }, value);
    onDone();
  }

  return (
    <form
      className="flex flex-col gap-4 pb-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (input && !passed) save(input);
      }}
    >
      <div className="flex flex-wrap gap-2">
        {quick.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() =>
              save({
                startsAt: option.startsAt,
                timeZone: deviceTimeZone(),
                floating: true,
                recurrence: null,
              })
            }
            className="flex min-h-11 flex-1 flex-col items-center justify-center rounded-xl bg-foreground/[0.06] px-3 py-1.5 text-sm outline-none hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <span className="font-medium">{option.label}</span>
            <span className="text-muted-foreground text-xs">
              {formatTimeOfDay(option.startsAt.slice(11))}
            </span>
          </button>
        ))}
      </div>
      {rang && reminder && (
        <Button
          type="button"
          variant="secondary"
          className="h-11 rounded-xl"
          onClick={() => {
            haptics.success();
            snoozeReminder(noteId, new Date(Date.now() + 60 * 60 * 1000));
            onDone();
          }}
        >
          Remind me again in an hour
        </Button>
      )}
      <div className="flex gap-3">
        <Field label="Date">
          {(id) => (
            <Input
              id={id}
              type="date"
              required
              value={form.date}
              onChange={(event) => update({ date: event.target.value })}
              className={fieldClass}
            />
          )}
        </Field>
        <Field label="Time">
          {(id) => (
            <Input
              id={id}
              type="time"
              required
              value={form.time}
              onChange={(event) => update({ time: event.target.value })}
              className={fieldClass}
            />
          )}
        </Field>
      </div>
      <Field label="Repeat">
        {(id) => (
          <Select
            id={id}
            value={form.repeat}
            options={REPEATS}
            onChange={(repeat) => update({ repeat })}
          />
        )}
      </Field>
      {form.repeat !== 'none' && (
        <>
          <Field label={`Every how many ${UNITS[form.repeat]}s`}>
            {(id) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={form.interval}
                onChange={(event) => update({ interval: event.target.valueAsNumber })}
                className={fieldClass}
              />
            )}
          </Field>
          {form.repeat === 'weekly' && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="px-1 pb-1.5 font-medium text-muted-foreground text-xs">
                On these days
              </legend>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((name, index) => {
                  // With none chosen it repeats on the start date's weekday.
                  const chosen =
                    form.weekdays.length > 0 ? form.weekdays.includes(index) : index === weekday;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-label={name}
                      aria-pressed={chosen}
                      onClick={() => {
                        haptics.selection();
                        const current = form.weekdays.length > 0 ? form.weekdays : [weekday];
                        const next = current.includes(index)
                          ? current.filter((item) => item !== index)
                          : [...current, index];
                        update({ weekdays: next });
                      }}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-xl font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
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
            </fieldset>
          )}
          {form.repeat === 'monthly' && (
            <Field label="On">
              {(id) => (
                <Select
                  id={id}
                  value={form.monthlyOn === 'last' && !inLastWeek ? 'nth' : form.monthlyOn}
                  options={[
                    {
                      value: 'day' as const,
                      label: day > 28 ? `Day ${day}, or the month's last day` : `Day ${day}`,
                    },
                    ...(day <= 28
                      ? [
                          {
                            value: 'nth' as const,
                            label: `The ${ordinalName(Math.ceil(day / 7))} ${WEEKDAYS[weekday]}`,
                          },
                        ]
                      : []),
                    ...(inLastWeek
                      ? [{ value: 'last' as const, label: `The last ${WEEKDAYS[weekday]}` }]
                      : []),
                  ]}
                  onChange={(monthlyOn) => update({ monthlyOn })}
                />
              )}
            </Field>
          )}
          <div className="flex gap-3">
            <Field label="Ends">
              {(id) => (
                <Select
                  id={id}
                  value={form.ends}
                  options={ENDS}
                  onChange={(ends) => update({ ends })}
                />
              )}
            </Field>
            {form.ends === 'until' && (
              <Field label="Last day">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    min={form.date}
                    value={form.until}
                    onChange={(event) => update({ until: event.target.value })}
                    className={fieldClass}
                  />
                )}
              </Field>
            )}
            {form.ends === 'count' && (
              <Field label="Times">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={9999}
                    value={form.count}
                    onChange={(event) => update({ count: event.target.valueAsNumber })}
                    className={fieldClass}
                  />
                )}
              </Field>
            )}
          </div>
        </>
      )}
      <div className="flex min-h-11 items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Keep in {form.timeZone.replaceAll('_', ' ')} time</p>
          <p className="text-muted-foreground text-xs">
            {form.fixed
              ? 'Rings at this time there, wherever you are.'
              : 'Off: it follows your clock when you travel.'}
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
      {passed && (
        <p role="alert" className="px-1 text-destructive text-sm">
          That time has passed{startsIn ? ` (${formatReminderTime(startsIn, now)})` : ''}.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {reminder && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-xl text-destructive"
            onClick={() => {
              haptics.warning();
              removeReminder(noteId);
              onDone();
            }}
          >
            Remove
          </Button>
        )}
        <Button type="submit" disabled={!input || passed} className="h-11 flex-1 rounded-xl">
          Save
        </Button>
      </div>
    </form>
  );
}

/** The sheet a note's reminder is set in. Opened through `reminderSheet`. */
export function ReminderSheet() {
  const noteId = reminderSheet.use();
  const reminders = useReminders();
  const note = noteId ? notesCollection.get(noteId) : undefined;
  const close = () => reminderSheet.set(null);

  return (
    <BottomSheet
      open={Boolean(note)}
      onOpenChange={(open) => !open && close()}
      title="Remind me"
      dragHandleOnly
      aboveNote
    >
      {note && (
        <ReminderForm
          key={note.id}
          noteId={note.id}
          userId={note.userId}
          reminder={reminders.get(note.id)}
          onDone={close}
        />
      )}
    </BottomSheet>
  );
}
