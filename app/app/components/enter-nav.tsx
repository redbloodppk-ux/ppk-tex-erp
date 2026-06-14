'use client';
/**
 * EnterNav — global "Enter moves to the next field" UX helper.
 *
 * Mounts a document-level keydown listener that catches plain Enter
 * (no Shift / Ctrl / Alt / Meta modifiers) on text-style <input> and
 * <select> elements and shifts focus to the next focusable element
 * within the same form (or the document body, if the element isn't
 * inside a form).
 *
 * Skipped on purpose:
 *   - <textarea>           Enter inserts a newline, never moves focus.
 *   - <input type="checkbox" | "radio" | "submit" | "button" | "reset" | "file">
 *                          Enter has its own native meaning on these.
 *   - Buttons              Same.
 *   - Modifier keys held   Enter+Shift / Ctrl / etc. always pass through.
 *   - Composition          IME composition (e.g. Tamil input) is left alone.
 *   - data-disable-enter-nav="true"  Per-element opt-out hook.
 *
 * When the next focusable element is a text input, its value is
 * selected so the operator can overwrite it immediately. If the
 * next element is a submit button, focus lands on it — pressing
 * Enter again then submits, matching expected form behaviour.
 */
import { useEffect } from 'react';

const TEXTY_INPUT_TYPES = new Set([
  'text', 'number', 'search', 'tel', 'email', 'url',
  'password', 'date', 'datetime-local', 'time', 'month', 'week',
]);

const SKIP_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image', 'range', 'color',
]);

const FOCUSABLE_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  '[contenteditable="true"]',
].join(', ');

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  // Walk up checking display:none / visibility:hidden.
  let node: HTMLElement | null = el;
  while (node) {
    const cs = window.getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

export function EnterNav(): null {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      // Skip while an IME is mid-composition (e.g. Tamil / CJK input).
      if (e.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;

      // Textareas: leave Enter alone (newline).
      if (tag === 'TEXTAREA') return;

      // Inputs / Selects only.
      if (tag === 'INPUT') {
        const inp = target as HTMLInputElement;
        if (SKIP_INPUT_TYPES.has(inp.type)) return;
      } else if (tag !== 'SELECT') {
        return;
      }

      // Per-element opt-out.
      if (target.dataset.disableEnterNav === 'true') return;
      // Also honour an ancestor opt-out — useful for "natural Enter" panels
      // like a chat / search overlay where the form should submit.
      if (target.closest('[data-disable-enter-nav="true"]')) return;

      // Scope: the nearest <form>, else the whole document. Some pages
      // build their forms outside a <form> tag (controlled by buttons),
      // so falling back to body keeps Enter-nav working.
      const root: HTMLElement = (target.closest('form') ?? document.body) as HTMLElement;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(isVisible);
      const idx = focusables.indexOf(target);
      if (idx < 0) return;
      const next = focusables[idx + 1];
      if (!next) return; // no next field — let native Enter submit if applicable

      e.preventDefault();
      next.focus();

      // Select-all on text inputs so the operator can overwrite the
      // pre-filled value with a single keystroke.
      if (next.tagName === 'INPUT') {
        const ni = next as HTMLInputElement;
        if (TEXTY_INPUT_TYPES.has(ni.type)) {
          try { ni.select(); } catch { /* ignore */ }
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => { document.removeEventListener('keydown', onKeyDown, true); };
  }, []);

  return null;
}
