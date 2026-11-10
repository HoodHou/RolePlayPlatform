import { memo, useMemo } from 'react';
import { formatNarration } from '../../lib/narration';

interface NarrationProps {
  text: string;
  streaming: boolean;
  /** Story language tag; drives CJK typography and pronunciation. */
  lang: string;
}

// Memoized: while a turn streams, only the narration being written re-renders.
export const Narration = memo(function Narration({ text, streaming, lang }: NarrationProps) {
  const content = useMemo(
    () => formatNarration(text, { trailing: streaming ? <span className="caret" aria-hidden="true" /> : undefined }),
    [text, streaming],
  );
  return (
    <div className="narration" lang={lang}>
      {content}
    </div>
  );
});
