import type { BlockNoteEditor } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { closeHistory } from '@tiptap/pm/history';
import { useEffect, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { keyboardHeight } from '@/lib/keyboard';

const LIST_ITEM =
  '[data-content-type="checkListItem"], [data-content-type="bulletListItem"], [data-content-type="numberedListItem"]';
const HOLD_DELAY = 350;
const MOVE_TOLERANCE = 8;
const INDENT_DISTANCE = 32;

/** Lists share a projected drop destination for touch holds and mouse drag handles. */
export function useListItemDrag(editor: BlockNoteEditor, editable: boolean) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!root || !editable) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let source: HTMLElement | null = null;
    let target: HTMLElement | null = null;
    let placement: 'before' | 'after' | 'nested' = 'before';
    let mousePending = false;
    let touchId = 0;
    let startX = 0;
    let startY = 0;
    let x = 0;
    let y = 0;
    let dragging = false;
    let suppressClick = false;
    let scrollArea: HTMLElement | null = null;
    let grabOffset = 0;
    let preview: HTMLElement | null = null;
    let marker: HTMLElement | null = null;
    let dimStyle: HTMLStyleElement | null = null;
    let touchTarget: Element | null = null;

    function clear() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      preview?.remove();
      marker?.remove();
      dimStyle?.remove();
      preview = null;
      marker = null;
      dimStyle = null;
      touchTarget?.removeEventListener('touchmove', onMove as EventListener);
      touchTarget?.removeEventListener('touchend', onEnd as EventListener);
      touchTarget?.removeEventListener('touchcancel', onEnd as EventListener);
      touchTarget = null;
      root?.removeAttribute('data-list-holding');
      source = null;
      target = null;
      dragging = false;
      mousePending = false;
      if (suppressClick) {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          suppressClick = false;
        }, 400);
      }
    }

    function refreshSource() {
      // Checklist node views can remount when touch changes the text selection.
      if (source && !source.isConnected) {
        source =
          root?.querySelector<HTMLElement>(
            `.bn-editor [data-node-type="blockOuter"][data-id="${CSS.escape(source.dataset.id ?? '')}"]`,
          ) ?? null;
      }
      return source;
    }

    function updateTarget() {
      if (!refreshSource()) return clear();
      if (!source || !root) return;
      if (preview) {
        preview.style.top = `${y - grabOffset - root.getBoundingClientRect().top}px`;
        preview.style.transform = `translateX(${x - startX}px)`;
      }
      if (marker) marker.hidden = true;
      target = null;
      const bounds = root.getBoundingClientRect();
      const scrollBounds = scrollArea?.getBoundingClientRect() ?? bounds;
      if (
        x < bounds.left - (mousePending ? INDENT_DISTANCE : 0) ||
        x > bounds.right ||
        y < Math.max(0, scrollBounds.top) ||
        y > Math.min(window.innerHeight - keyboardHeight.get(), scrollBounds.bottom)
      )
        return;

      const siblings = Array.from(source.parentElement?.children ?? []).filter(
        (element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.id,
      );
      let nearest = Number.POSITIVE_INFINITY;
      for (const sibling of siblings) {
        const rect = sibling.getBoundingClientRect();
        const after = y > rect.top + rect.height / 2;
        const distance = Math.abs(y - (after ? rect.bottom : rect.top));
        if (distance >= nearest) continue;
        nearest = distance;
        target = sibling;
        placement = after ? 'after' : 'before';
      }
      if (!target) return;
      const offset = x - startX;
      if (offset >= INDENT_DISTANCE) {
        const slot = siblings.indexOf(target) + (placement === 'after' ? 1 : 0);
        const previous = siblings.slice(0, slot).findLast((sibling) => sibling !== source);
        const previousBlock = previous?.dataset.id
          ? editor.getBlock(previous.dataset.id)
          : undefined;
        if (
          previous &&
          previousBlock &&
          ['checkListItem', 'bulletListItem', 'numberedListItem'].includes(previousBlock.type)
        ) {
          target = previous;
          placement = 'nested';
        }
      } else if (offset <= -INDENT_DISTANCE) {
        let parent = source.parentElement?.closest<HTMLElement>('[data-node-type="blockOuter"]');
        const levels = Math.floor(-offset / INDENT_DISTANCE);
        for (let level = 1; parent && level < levels; level++) {
          const ancestor = parent.parentElement?.closest<HTMLElement>(
            '[data-node-type="blockOuter"]',
          );
          if (!ancestor) break;
          parent = ancestor;
        }
        if (parent) {
          target = parent;
          placement = 'after';
        }
      }
      if (target === source) return;
      if (marker) {
        const rect = target.getBoundingClientRect();
        const indent = placement === 'nested' ? INDENT_DISTANCE : 0;
        marker.hidden = false;
        marker.dataset.listDrop = placement;
        marker.style.left = `${rect.left - bounds.left + indent}px`;
        marker.style.top = `${(placement === 'before' ? rect.top : rect.bottom) - bounds.top - 2}px`;
        marker.style.width = `${Math.max(0, rect.width - indent)}px`;
      }
    }

    function autoScroll() {
      if (!dragging || !scrollArea) return;
      const bounds = scrollArea.getBoundingClientRect();
      const top = Math.max(0, bounds.top);
      const bottom = Math.min(window.innerHeight - keyboardHeight.get(), bounds.bottom);
      const speed =
        y < top + 48
          ? -Math.min(10, (top + 48 - y) / 4)
          : y > bottom - 48
            ? Math.min(10, (y - bottom + 48) / 4)
            : 0;
      scrollArea.scrollTop += speed;
      updateTarget();
      frame = requestAnimationFrame(autoScroll);
    }

    function onStart(event: TouchEvent) {
      clear();
      clearTimeout(clickTimer);
      suppressClick = false;
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
      if (event.target.closest('input, button, a, [contenteditable="false"]')) return;
      const item = event.target.closest(LIST_ITEM);
      const outer = item?.closest<HTMLElement>('[data-node-type="blockOuter"]');
      const touch = event.touches[0];
      if (!outer?.dataset.id || !touch) return;
      source = outer;
      // Native touch events keep their original target even if a node view remounts.
      touchTarget = event.target;
      touchTarget.addEventListener('touchmove', onMove as EventListener, { passive: false });
      touchTarget.addEventListener('touchend', onEnd as EventListener, { passive: false });
      touchTarget.addEventListener('touchcancel', onEnd as EventListener);
      touchId = touch.identifier;
      startX = x = touch.clientX;
      startY = y = touch.clientY;
      root?.setAttribute('data-list-holding', '');
      timer = setTimeout(beginDrag, HOLD_DELAY);
    }

    function beginDrag() {
      if (!root || !refreshSource() || !source) return clear();
      dragging = true;
      // A move replaces the block's DOM; detach the handle from its old reference first.
      editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen();
      suppressClick = true;
      window.getSelection()?.removeAllRanges();
      const bounds = root.getBoundingClientRect();
      const rect = source.getBoundingClientRect();
      grabOffset = y - rect.top;
      // ProseMirror restores attributes changed inside its DOM. Keep the drag visuals
      // outside its contenteditable instead, and leave the document alone until drop.
      const clone = source.cloneNode(true) as HTMLElement;
      for (const element of [clone, ...clone.querySelectorAll('[id], [data-id]')]) {
        element.removeAttribute('id');
        element.removeAttribute('data-id');
      }
      preview = document.createElement('div');
      preview.classList.add('bn-block-group', 'bn-default-styles');
      preview.append(clone);
      preview.setAttribute('data-list-dragging', '');
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      preview.contentEditable = 'false';
      preview.style.left = `${rect.left - bounds.left}px`;
      preview.style.top = `${rect.top - bounds.top}px`;
      preview.style.width = `${rect.width}px`;
      marker = document.createElement('div');
      marker.setAttribute('aria-hidden', 'true');
      marker.hidden = true;
      dimStyle = document.createElement('style');
      const id = CSS.escape(source.dataset.id ?? '');
      root.setAttribute('data-list-holding', source.dataset.id ?? '');
      dimStyle.textContent = `.note-editor[data-list-holding="${id}"] .bn-editor [data-node-type="blockOuter"][data-id="${id}"] { opacity: 0.35; }`;
      root.append(preview, marker, dimStyle);
      scrollArea = root?.parentElement ?? null;
      while (scrollArea && !/(auto|scroll)/.test(getComputedStyle(scrollArea).overflowY)) {
        scrollArea = scrollArea.parentElement;
      }
      haptics.longPress();
      frame = requestAnimationFrame(autoScroll);
    }

    function onMove(event: TouchEvent) {
      if (!source) return;
      const touch = Array.from(event.touches).find((entry) => entry.identifier === touchId);
      if (!touch || event.touches.length !== 1) return clear();
      x = touch.clientX;
      y = touch.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) > MOVE_TOLERANCE) clear();
        return;
      }
      // The enclosing note also handles swipes; this gesture belongs to the list.
      event.preventDefault();
      event.stopPropagation();
      updateTarget();
    }

    function onEnd(event: TouchEvent) {
      if (!dragging) return clear();
      event.preventDefault();
      event.stopPropagation();
      finishDrop(event.type === 'touchcancel' || event.touches.length !== 0);
    }

    function finishDrop(cancelled: boolean) {
      const id = source?.dataset.id;
      const targetId = target?.dataset.id;
      const block = id ? editor.getBlock(id) : undefined;
      const destination = targetId ? editor.getBlock(targetId) : undefined;
      const dropPlacement = placement;
      clear();
      editor.getExtension(SideMenuExtension)?.hideMenuIfNotFrozen();
      if (cancelled || !block || !destination || block.id === destination.id) return;
      const parent = editor.getParentBlock(block);
      const destinationParent = editor.getParentBlock(destination);
      if (dropPlacement !== 'nested' && parent?.id === destinationParent?.id) {
        const siblings = parent?.children ?? editor.document;
        const index = siblings.findIndex((sibling) => sibling.id === block.id);
        const targetIndex = siblings.findIndex((sibling) => sibling.id === destination.id);
        const slot = targetIndex + (dropPlacement === 'after' ? 1 : 0);
        if (targetIndex < 0 || slot === index || slot === index + 1) return;
      }
      // One transaction preserves IDs, marks, check state and children in one undo step.
      editor.transact((tr) => {
        closeHistory(tr);
        editor.removeBlocks([block]);
        if (dropPlacement === 'nested') {
          const current = editor.getBlock(destination.id);
          if (current) editor.updateBlock(current, { children: [...current.children, block] });
        } else {
          editor.insertBlocks([block], destination, dropPlacement);
        }
        editor.setTextCursorPosition(block, 'end');
      });
      editor.transact((tr) => closeHistory(tr));
      haptics.success();
    }

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || event.button !== 0 || !(event.target instanceof Element))
        return;
      if (!event.target.closest('.bn-side-menu [draggable="true"]')) return;
      const block = editor.getExtension(SideMenuExtension)?.store.state?.block;
      if (!block || !['checkListItem', 'bulletListItem', 'numberedListItem'].includes(block.type))
        return;
      const selection = editor.getSelection();
      if (selection && (selection.blocks.length !== 1 || selection.blocks[0]?.id !== block.id))
        return;
      // Delay the menu until click and keep native drag from competing with this gesture.
      event.preventDefault();
      clear();
      source =
        root?.querySelector<HTMLElement>(
          `.bn-editor [data-node-type="blockOuter"][data-id="${CSS.escape(block.id)}"]`,
        ) ?? null;
      if (!source) return;
      clearTimeout(clickTimer);
      suppressClick = false;
      mousePending = true;
      startX = x = event.clientX;
      startY = y = event.clientY;
    }

    function onNativeDragStart(event: DragEvent) {
      if (!mousePending) return;
      event.preventDefault();
      event.stopPropagation();
    }

    function onPointerMove(event: PointerEvent) {
      if (!mousePending || event.pointerType !== 'mouse') return;
      x = event.clientX;
      y = event.clientY;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) <= MOVE_TOLERANCE) return;
        beginDrag();
        if (!dragging) return;
      }
      event.preventDefault();
      event.stopPropagation();
      updateTarget();
    }

    function onMouseMove(event: MouseEvent) {
      // A phone's long press sends a mousemove too. The block handle would follow it to the
      // row being dragged, and the drop replaces that row's DOM out from under it.
      if (dragging) event.stopPropagation();
    }

    function onPointerUp(event: PointerEvent) {
      if (!mousePending || event.pointerType !== 'mouse') return;
      if (!dragging) return clear();
      event.preventDefault();
      event.stopPropagation();
      x = event.clientX;
      y = event.clientY;
      updateTarget();
      finishDrop(event.type === 'pointercancel');
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!source || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      clear();
    }

    function onClick(event: MouseEvent) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function onContextMenu(event: Event) {
      if (source) event.preventDefault();
    }

    window.addEventListener('blur', clear);
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onPointerDown, true);
    root.addEventListener('dragstart', onNativeDragStart, true);
    document.addEventListener('pointermove', onPointerMove, true);
    // The window comes before the document, where BlockNote listens for the same event.
    window.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    root.addEventListener('touchstart', onStart, { passive: true, capture: true });
    root.addEventListener('touchmove', onMove, { passive: false, capture: true });
    root.addEventListener('touchend', onEnd, { passive: false, capture: true });
    root.addEventListener('touchcancel', onEnd, { capture: true });
    root.addEventListener('click', onClick, true);
    root.addEventListener('contextmenu', onContextMenu);
    return () => {
      clear();
      clearTimeout(clickTimer);
      window.removeEventListener('blur', clear);
      document.removeEventListener('keydown', onKeyDown, true);
      root.removeEventListener('pointerdown', onPointerDown, true);
      root.removeEventListener('dragstart', onNativeDragStart, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      root.removeEventListener('touchstart', onStart, true);
      root.removeEventListener('touchmove', onMove, true);
      root.removeEventListener('touchend', onEnd, true);
      root.removeEventListener('touchcancel', onEnd, true);
      root.removeEventListener('click', onClick, true);
      root.removeEventListener('contextmenu', onContextMenu);
    };
  }, [editor, editable, root]);
  return setRoot;
}
