import type { DialogueMessage } from '@roleplay/shared';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { focusComposer } from '../../lib/composer';
import { formatNarration } from '../../lib/narration';
import { useGame } from '../../store/game';
import { CharacterAvatar } from '../CharacterAvatar';

interface DialogueLineProps {
  message: DialogueMessage;
  /** The speaker's current portrait, looked up by id. */
  imageUrl: string | undefined;
  streaming: boolean;
  lang: string;
  /** The speaker is still in the scene: clicking their name starts talking to them. */
  canTalk: boolean;
}

/**
 * A character speaking for themselves, set like a line in a script: who speaks,
 * then their words, with *actions* as stage directions.
 */
export const DialogueLine = memo(function DialogueLine({ message, imageUrl, streaming, lang, canTalk }: DialogueLineProps) {
  const { t } = useTranslation();
  const startTalking = useGame((s) => s.startTalking);
  const name = message.characterName;
  const content = useMemo(
    () =>
      message.text
        ? formatNarration(message.text, {
            tintSpeech: false,
            trailing: streaming ? <span className="caret" aria-hidden="true" /> : undefined,
          })
        : null,
    [message.text, streaming],
  );
  // A line that was announced but never written has nothing to show once the turn is over.
  if (!content && !streaming) return null;

  const speaker = (
    <>
      <CharacterAvatar name={name} imageUrl={imageUrl} />
      <span className="dialogue__name" lang={lang}>
        {name}
      </span>
    </>
  );

  return (
    <div className="dialogue">
      {canTalk ? (
        <button
          type="button"
          className="dialogue__speaker is-interactive"
          title={t('story.talkTo', { name })}
          aria-label={t('story.talkTo', { name })}
          onClick={() => {
            startTalking(message.characterId);
            focusComposer();
          }}
        >
          {speaker}
        </button>
      ) : (
        <div className="dialogue__speaker">{speaker}</div>
      )}
      <div className="dialogue__line" lang={lang}>
        {content ?? (
          <p className="dialogue__typing" role="img" aria-label={t('story.aboutToSpeak', { name })}>
            <span />
            <span />
            <span />
          </p>
        )}
      </div>
    </div>
  );
});
