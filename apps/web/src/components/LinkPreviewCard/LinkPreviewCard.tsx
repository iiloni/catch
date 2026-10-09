import type { LinkPreview } from '@catch/shared';
import { linkDomain } from '@catch/shared';
import {
  Copy,
  EyeOff,
  Globe,
  Image,
  MoreHorizontal,
  RefreshCw,
  Share2,
  Text,
  TextSearch,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  assetUrl,
  canShare,
  copyLink,
  linkTitle,
  type ResolvedLink,
  refreshLinkPreview,
  shareLink,
} from '@/lib/linkPreviews';
import { hideLinkPreview, setGalleryPreview } from '@/lib/notes';
import { cn } from '@/lib/utils';

/** Tints an element with a link's site color (see `[data-link-tint]` in styles.css). */
export function linkTint(preview: LinkPreview | undefined) {
  const hue = preview?.hue ?? null;
  return {
    'data-link-tint': '',
    'data-link-hue': hue ?? undefined,
    style: (hue === null ? {} : { '--link-hue': hue }) as CSSProperties,
  };
}

/** A site's icon, or a globe for sites without one (and before the preview arrives). */
export function SiteIcon({ link, className }: { link: ResolvedLink; className?: string }) {
  const hash = link.preview?.iconHash;
  if (!hash) {
    return <Globe className={cn('size-4 shrink-0 text-link-accent', className)} aria-hidden />;
  }
  return (
    <img
      src={assetUrl(hash)}
      alt=""
      loading="lazy"
      draggable={false}
      // Many icons are dark marks on nothing, which vanish on a dark card without a backing.
      className={cn(
        'size-4 shrink-0 rounded-[4px] bg-[light-dark(transparent,oklch(0.97_0_0))] object-contain',
        className,
      )}
    />
  );
}

function Thumbnail({ link }: { link: ResolvedLink }) {
  const { imageHash } = link.preview ?? {};
  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-link-accent/12">
      {imageHash ? (
        <img
          src={assetUrl(imageHash)}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
        />
      ) : (
        <SiteIcon link={link} className="size-7 rounded-md" />
      )}
    </div>
  );
}

type Props = {
  link: ResolvedLink;
  /** The note the link is in, which removing the preview changes. */
  noteId: string;
  /** Scrolls the note to the link. Offered only where the note is open. */
  onShowInNote?: () => void;
  /** Leaves out actions that change the note, as for a note in the trash. */
  readOnly?: boolean;
  galleryPreviewUrl?: string | null;
  /** Readers may choose their own card face without editing the shared note. */
  canChooseGalleryPreview?: boolean;
  className?: string;
};

/**
 * A link's preview: thumbnail, title and site, tinted with the site's color. Tapping opens
 * the link; the menu copies, shares, refreshes or removes it.
 */
export function LinkPreviewCard({
  link,
  noteId,
  onShowInNote,
  readOnly,
  galleryPreviewUrl,
  canChooseGalleryPreview,
  className,
}: Props) {
  const { preview } = link;
  const pending = !preview || preview.status === 'pending';
  const site = preview?.siteName ?? linkDomain(link.url);

  return (
    <article
      data-link-card={link.url}
      aria-label={linkTitle(link)}
      {...linkTint(preview)}
      className={cn(
        'relative flex min-w-0 rounded-2xl bg-link text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] ring-1 ring-foreground/[0.06] ring-inset',
        className,
      )}
    >
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        draggable={false}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2 pr-10 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Thumbnail link={link} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p
            className={cn(
              'line-clamp-2 break-words font-medium text-sm leading-snug',
              !preview?.title && 'text-muted-foreground',
            )}
          >
            {linkTitle(link)}
          </p>
          {pending && preview?.title === undefined ? (
            <span aria-hidden className="h-3 w-2/3 animate-pulse rounded-full bg-foreground/10" />
          ) : null}
          <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            <SiteIcon link={link} className="size-3.5" />
            <span className="truncate">{site}</span>
          </p>
        </div>
      </a>
      <LinkMenu
        link={link}
        noteId={noteId}
        onShowInNote={onShowInNote}
        readOnly={readOnly}
        galleryPreviewUrl={galleryPreviewUrl}
        canChooseGalleryPreview={canChooseGalleryPreview}
      />
    </article>
  );
}

function LinkMenu({
  link,
  noteId,
  onShowInNote,
  readOnly,
  galleryPreviewUrl,
  canChooseGalleryPreview = !readOnly,
}: Omit<Props, 'className'>) {
  const selected = galleryPreviewUrl === link.url;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Link options"
          className="absolute top-1 right-1 size-8 rounded-full text-muted-foreground"
          // Keeps focus (and the keyboard) in the editor when the card sits under the note.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      {/* Above the link overlay and the open note. */}
      <DropdownMenuContent align="end" className="z-[80]">
        <DropdownMenuItem onSelect={() => void copyLink(link.href)}>
          <Copy /> Copy link
        </DropdownMenuItem>
        {canShare() && (
          <DropdownMenuItem onSelect={() => shareLink(link)}>
            <Share2 /> Share
          </DropdownMenuItem>
        )}
        {onShowInNote && (
          <DropdownMenuItem onSelect={onShowInNote}>
            <TextSearch /> Show in note
          </DropdownMenuItem>
        )}
        {canChooseGalleryPreview && (
          <DropdownMenuItem onSelect={() => setGalleryPreview(noteId, selected ? null : link.url)}>
            {selected ? <Text /> : <Image />}
            {selected ? 'Show Text in Gallery' : 'Show as Gallery Preview'}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={!link.preview || link.preview.status === 'pending'}
          onSelect={() => void refreshLinkPreview(link.url)}
        >
          <RefreshCw /> Refresh preview
        </DropdownMenuItem>
        {!readOnly && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => hideLinkPreview(noteId, link.url)}>
              <EyeOff /> Remove preview
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A note that is nothing but a link shows as the link itself: its image across the top, then
 * its title and site. It keeps the note's color when the user chose one.
 */
export function LinkNoteFace({ link, tinted }: { link: ResolvedLink; tinted: boolean }) {
  const { preview } = link;
  const image = preview?.imageHash;
  const ratio =
    preview?.imageWidth && preview.imageHeight
      ? Math.max(0.6, Math.min(1.91, preview.imageWidth / preview.imageHeight))
      : 1.91;
  return (
    <div
      data-gallery-preview={link.url}
      {...(tinted ? linkTint(preview) : {})}
      className={cn(tinted && 'bg-link', 'rounded-2xl')}
    >
      {image && (
        <img
          src={assetUrl(image)}
          alt=""
          loading="lazy"
          draggable={false}
          className="w-full rounded-t-2xl object-cover"
          style={{ aspectRatio: ratio }}
        />
      )}
      <div className="flex flex-col gap-1.5 px-3.5 pt-3 pb-3.5">
        <h3
          className={cn(
            'line-clamp-3 break-words font-display font-semibold text-[0.9375rem] leading-snug tracking-[-0.01em]',
            !preview?.title && 'font-sans font-medium text-muted-foreground text-sm',
          )}
        >
          {linkTitle(link)}
        </h3>
        <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <SiteIcon link={link} className="size-3.5" />
          <span className="truncate">{preview?.siteName ?? linkDomain(link.url)}</span>
        </p>
      </div>
    </div>
  );
}
