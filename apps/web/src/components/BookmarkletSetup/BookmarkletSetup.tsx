import { Copy, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { captureBookmarklet } from '@/lib/linkCapture';
import { getServerUrl } from '@/lib/serverUrl';

export function BookmarkletSetup() {
  const bookmarklet = captureBookmarklet(getServerUrl());
  return (
    <SettingsSection
      title="Link capture"
      description="On a page you want to keep, click the bookmark to open a small Catch window. You can edit the page details before saving. If dragging is unavailable, copy the bookmarklet and paste it into a bookmark’s URL field."
    >
      <SettingsRow
        icon={Link2}
        label={
          <a
            href="/capture"
            // React blocks javascript: attributes. This code is generated locally from the
            // instance URL, and is installed as a bookmark rather than executed in the app.
            ref={(anchor) => {
              anchor?.setAttribute('href', bookmarklet);
            }}
            draggable
            onClick={(event) => {
              event.preventDefault();
              toast('Drag Save to Catch to your bookmarks bar, or copy the bookmarklet.');
            }}
            className="rounded-sm text-[color:var(--brand-link)] underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            Save to Catch
          </a>
        }
        description="Drag this link to your bookmarks bar"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy bookmarklet"
          className="size-11 rounded-xl"
          onClick={() => {
            void navigator.clipboard.writeText(bookmarklet).then(
              () => toast('Bookmarklet copied'),
              () =>
                toast.error('Could not copy. Drag Save to Catch to your bookmarks bar instead.'),
            );
          }}
        >
          <Copy aria-hidden />
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
