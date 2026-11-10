export const COMPOSER_INPUT_ID = 'composer-input';

/**
 * Moves focus to the composer. When the same click also closes a drawer, flush
 * that update first (`flushSync`): closing hands focus back to the drawer's
 * opener, and this must come after it.
 */
export function focusComposer(): void {
  document.getElementById(COMPOSER_INPUT_ID)?.focus();
}
