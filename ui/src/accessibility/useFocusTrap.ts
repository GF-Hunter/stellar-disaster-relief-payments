import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Selector for elements that can receive keyboard focus inside a dialog.
 * Disabled controls and elements explicitly removed from the tab order are
 * excluded.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Trap keyboard focus inside a dialog while it is open.
 *
 * Behaviour:
 * - moves focus to the first focusable control (or the container) on open;
 * - cycles Tab / Shift+Tab within the container;
 * - calls `onEscape` when Escape is pressed;
 * - restores focus to the previously focused element on close.
 *
 * The hook is intentionally dependency-free so it can be reused by all
 * confirmation and detail modals. `onEscape` is read through a ref so passing
 * an inline callback does not re-run the effect and steal focus on re-render.
 *
 * @param isOpen   Whether the dialog is currently mounted.
 * @param onEscape Callback invoked when the user presses Escape.
 * @returns A ref to attach to the dialog container (`tabIndex={-1}`).
 */
export function useFocusTrap<T extends HTMLElement>(
  isOpen: boolean,
  onEscape: () => void
): RefObject<T> {
  const containerRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isOpen) return;

    const container = containerRef.current;
    if (!container) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute('disabled') &&
          element.getAttribute('aria-hidden') !== 'true'
      );

    const initial = getFocusable()[0] ?? container;
    if (initial === container && !container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }
    initial.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !(active instanceof Node) || !container.contains(active);

      if (event.shiftKey && (active === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
