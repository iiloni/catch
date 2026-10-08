import { DEFAULT_BOARD_STATUS, type NoteColor, normalizeSecondaryTags } from '@catch/shared';
import { boardColumnsCollection, tagsCollection } from './collections';

export type LinkCapturePlacement = {
  status: string | null;
  color: NoteColor;
  primaryTagId: string | null;
  secondaryTagIds: string[];
};

/** Resolve against hydrated rows in case a column or tag was deleted while the form was open. */
export function resolveLinkCapturePlacement(placement: LinkCapturePlacement): LinkCapturePlacement {
  const primaryTagId =
    placement.primaryTagId && tagsCollection.has(placement.primaryTagId)
      ? placement.primaryTagId
      : null;
  return {
    status:
      placement.status === null || boardColumnsCollection.has(placement.status)
        ? placement.status
        : DEFAULT_BOARD_STATUS,
    color: primaryTagId ? 'default' : placement.color,
    primaryTagId,
    secondaryTagIds: normalizeSecondaryTags(
      [...tagsCollection.values()],
      placement.secondaryTagIds.filter((id) => id !== primaryTagId && tagsCollection.has(id)),
    ),
  };
}
