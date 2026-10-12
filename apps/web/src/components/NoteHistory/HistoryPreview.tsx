import type { Note } from '@catch/shared';
import { Component, lazy, type ReactNode, Suspense, useState } from 'react';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { Button } from '@/components/ui/button';

const HistoryDocument = lazy(() => import('./HistoryDocument'));
class UnsupportedDocument extends Component<
  { content: Note['content']; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p className="px-4 text-muted-foreground text-sm">
          Some content cannot be rendered in this viewer. Its complete document data is preserved.
        </p>
        <NotePreview
          content={this.props.content}
          maxBlocks={Number.MAX_SAFE_INTEGER}
          variant="editor"
          reading
        />
        <details className="m-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm">
            View preserved document data
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(this.props.content, null, 2)}
          </pre>
        </details>
      </>
    );
  }
}
/** Grow long documents explicitly; recovery always uses the complete, unmodified state. */
export function HistoryPreview({ content }: { content: Note['content'] }) {
  const [count, setCount] = useState(40);
  const shown = content.slice(0, count);
  return (
    <>
      <UnsupportedDocument key={count} content={shown}>
        <Suspense
          fallback={<NotePreview content={shown} maxBlocks={count} variant="editor" reading />}
        >
          <HistoryDocument content={shown} />
        </Suspense>
      </UnsupportedDocument>
      {content.length > count && (
        <div className="px-4 py-3">
          <p className="mb-2 text-muted-foreground text-sm">
            Showing {count} of {content.length} blocks. Restore and copy use the entire version.
          </p>
          <Button
            variant="outline"
            className="min-h-11 rounded-xl"
            onClick={() => setCount((value) => value + 40)}
          >
            Show more content
          </Button>
        </div>
      )}
    </>
  );
}
