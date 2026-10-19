import { describe, expect, it } from 'vitest';
import { insertMention, mentionedIn, mentionQuery, mentionSegments, messageTicks } from './messages';
import type { ReadState } from './schemas/chat';

const sam = { userId: 's', displayName: 'Sam' };
const samLee = { userId: 'sl', displayName: 'Sam Lee' };
const priya = { userId: 'p', displayName: 'Priya' };

describe('mentions', () => {
  it('splits out the people mentioned, longest name first', () => {
    expect(mentionSegments('Ask @Sam Lee and @Priya!', [sam, samLee, priya])).toEqual([
      { text: 'Ask ', userId: null },
      { text: '@Sam Lee', userId: 'sl' },
      { text: ' and ', userId: null },
      { text: '@Priya', userId: 'p' },
      { text: '!', userId: null },
    ]);
  });

  it('doesn’t match a name inside a longer word', () => {
    expect(mentionSegments('@Samuel is here', [sam])).toEqual([{ text: '@Samuel is here', userId: null }]);
  });

  it('keeps only mentions still in the text', () => {
    expect(mentionedIn('thanks @Priya', [sam, priya])).toEqual(['p']);
  });

  it('notices "@" being typed and fills in the name', () => {
    expect(mentionQuery('hey @pr')).toBe('pr');
    expect(mentionQuery('hey @')).toBe('');
    expect(mentionQuery('mail me at a@b')).toBeNull();
    expect(mentionQuery('hey @Priya done')).toBeNull();
    expect(insertMention('hey @pr', 'Priya')).toBe('hey @Priya ');
  });
});

describe('messageTicks', () => {
  const sent = { createdAt: '2026-10-19T10:00:00.000Z', senderId: 'me' };
  const members = [
    { userId: 'me', joinedAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'a', joinedAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'b', joinedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const state = (userId: string, lastDeliveredAt: string | null, lastReadAt: string | null, readHidden = false): ReadState => ({
    userId,
    lastDeliveredAt,
    lastReadAt,
    readHidden,
  });
  const later = '2026-10-19T10:05:00.000Z';
  const earlier = '2026-10-19T09:00:00.000Z';

  it('is sent until everyone has it, delivered until everyone read it', () => {
    expect(messageTicks(sent, members, [state('a', later, null)], true)).toBe('sent');
    expect(messageTicks(sent, members, [state('a', later, null), state('b', later, earlier)], true)).toBe('delivered');
    expect(messageTicks(sent, members, [state('a', later, later), state('b', null, later)], true)).toBe('read');
  });

  it('only waits for people who were there when it was sent', () => {
    const joinedLater = [...members, { userId: 'c', joinedAt: later }];
    expect(messageTicks(sent, joinedLater, [state('a', later, later), state('b', later, later)], true)).toBe('read');
  });

  it('counts hidden readers once delivered, and shows no reads to someone hiding theirs', () => {
    const states = [state('a', later, null, true), state('b', later, later)];
    expect(messageTicks(sent, members, states, true)).toBe('read');
    expect(messageTicks(sent, members, states, false)).toBe('delivered');
  });
});
