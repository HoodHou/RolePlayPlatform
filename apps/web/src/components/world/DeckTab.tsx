import type { CardDeck, DeckState, RandomTable } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

function DeckCardView({ deck, lang }: { deck: CardDeck; lang: string }) {
  const { t } = useTranslation();
  const total = deck.remaining.length + deck.drawn.length;
  const recent = [...deck.drawn].reverse().slice(0, 5);

  return (
    <li className="card">
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {deck.name}
        </h4>
        <span className="tag">
          {t('world.deck.remaining', { remaining: deck.remaining.length, total })}
        </span>
      </div>
      {deck.description && (
        <p className="card__text" lang={lang}>
          {deck.description}
        </p>
      )}
      {recent.length > 0 && (
        <div className="places__links">
          <span className="card__label">{t('world.deck.drawnCards')}</span>
          <ul className="chips">
            {recent.map((card, idx) => (
              <li key={`${card.id}:${idx}`} className="chip" title={card.meaning || undefined}>
                <span className="chip__name" lang={lang}>
                  {card.name}
                </span>
                {card.reversed && <span className="chip__val">({t('world.deck.reversed')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function TableCardView({ table, lang }: { table: RandomTable; lang: string }) {
  const { t } = useTranslation();

  return (
    <li className="card">
      <div className="card__head">
        <h4 className="card__title" lang={lang}>
          {table.name}
        </h4>
        <span className="tag">{t('world.deck.entries', { count: table.entries.length })}</span>
      </div>
      {table.description && (
        <p className="card__text" lang={lang}>
          {table.description}
        </p>
      )}
      <ul className="chips">
        {table.entries.map((entry) => (
          <li key={entry.id} className="chip" title={entry.description || undefined}>
            <span className="chip__name" lang={lang}>
              {entry.label}
            </span>
            <span className="chip__val">×{entry.weight}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Read-only view of card decks and weighted random tables. */
export function DeckTab({ deck, lang }: { deck: DeckState; lang: string }) {
  const { t } = useTranslation();
  const decks = Object.values(deck.decks);
  const tables = Object.values(deck.tables);

  return (
    <div className="deck">
      {decks.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.deck.decksTitle')}</h3>
          <ul className="cards">
            {decks.map((d) => (
              <DeckCardView key={d.id} deck={d} lang={lang} />
            ))}
          </ul>
        </section>
      )}
      {tables.length > 0 && (
        <section className="world-section">
          <h3 className="eyebrow">{t('world.deck.tablesTitle')}</h3>
          <ul className="cards">
            {tables.map((tbl) => (
              <TableCardView key={tbl.id} table={tbl} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
