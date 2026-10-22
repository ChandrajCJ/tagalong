import { Share } from 'react-native';

/** The recap's stats card, as lines: a title, then one line per fact. */
export interface RecapCard {
  title: string;
  subtitle: string;
  lines: string[];
  colour: string;
}

/** Phones can't turn a view into a picture without a new app build, so they share the stats as text. */
export const canSaveImage = false;

export const shareRecap = async (card: RecapCard) => {
  await Share.share({ message: [card.title, card.subtitle, '', ...card.lines].join('\n') });
};
