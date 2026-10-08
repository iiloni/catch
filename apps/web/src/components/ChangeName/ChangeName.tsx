import { UserRound } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { changeAccountName } from '@/lib/auth';
import { haptics } from '@/lib/haptics';

type Props = { name: string; onChanged: () => void };

export function ChangeName({ name, onChanged }: Props) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const next = draft.trim();
    if (!next) {
      setError('Enter a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await changeAccountName(next);
      if (result.error) {
        setError(result.error.message || 'Could not change your name.');
        return;
      }
      onChanged();
      close();
      haptics.success();
      toast.success('Name changed');
    } catch {
      setError('Could not change your name. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsRow icon={UserRound} label="Name" description="How your account appears in Catch">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (pending) return;
          if (value) {
            setDraft(name);
            setError(null);
            setOpen(true);
          } else close();
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" className="h-11 rounded-full">
            Change name
          </Button>
        </DialogTrigger>
        <DialogContent
          showCloseButton={!pending}
          className="top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogTitle>Change name</DialogTitle>
          <DialogDescription>Choose the name shown for your account in Catch.</DialogDescription>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <label htmlFor={fieldId} className="flex flex-col gap-2 text-sm">
              Name
              <Input
                id={fieldId}
                autoComplete="name"
                required
                value={draft}
                disabled={pending}
                onChange={(event) => setDraft(event.target.value)}
                className="h-11"
              />
            </label>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={close}
                className="h-11 rounded-full"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="h-11 rounded-full">
                {pending ? 'Saving…' : 'Save name'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
