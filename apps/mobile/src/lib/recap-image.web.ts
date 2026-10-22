import { light } from '@/palette';
import type { RecapCard } from './recap-image';

export type { RecapCard } from './recap-image';

/** The web app draws the stats card onto a canvas and saves it as a PNG, ready for WhatsApp. */
export const canSaveImage = true;

export const shareRecap = async (card: RecapCard) => {
  const width = 1080;
  const lineHeight = 64;
  const height = 360 + card.lines.length * lineHeight + 80;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = card.colour;
  g.fillRect(0, 0, width, height);
  g.fillStyle = light.overlay;
  g.fillRect(0, 0, width, height);
  g.fillStyle = light.onPhoto;
  g.font = 'bold 76px system-ui, sans-serif';
  g.fillText(card.title, 72, 160, width - 144);
  g.font = '40px system-ui, sans-serif';
  g.fillText(card.subtitle, 72, 230, width - 144);
  g.font = '44px system-ui, sans-serif';
  card.lines.forEach((line, i) => g.fillText(line, 72, 340 + i * lineHeight, width - 144));
  g.font = '32px system-ui, sans-serif';
  g.fillStyle = light.onPhotoMuted;
  g.fillText('Made with Tagalong', 72, height - 56);
  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = `${card.title.replace(/[^\w -]+/g, '').trim() || 'trip'} recap.png`;
  link.click();
};
