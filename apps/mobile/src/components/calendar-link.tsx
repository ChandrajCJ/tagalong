import Feather from '@expo/vector-icons/Feather';
import { CalendarFeed, calendarFeedUrl, googleCalendarUrl, NewCalendarFeed, webcalUrl } from '@tagalong/shared';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { API_URL, ApiError, request } from '@/lib/api';
import { confirmAction } from '@/lib/confirm';
import { secureStorage } from '@/lib/storage';
import { colors, fonts, radius, space } from '@/theme';
import { Body, Button } from './ui';

/** Keychain keys allow only letters, digits, ".", "-" and "_". */
const keyFor = (userId: string) => `calendar-link.${userId}`;

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/**
 * Profile → Calendar: a private link Google or Apple Calendar subscribes to,
 * so every trip, timed stop and booking shows up there and stays in step.
 * The server keeps only a hash, so the link is remembered on this device;
 * elsewhere, a new link replaces it.
 */
export function CalendarLink({ userId }: { userId: string }) {
  const [feed, setFeed] = useState<CalendarFeed>();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();

  useEffect(() => {
    void request('/me/calendar', { schema: CalendarFeed })
      .then(async (status) => {
        setFeed(status);
        setLink(status.active ? await secureStorage.get(keyFor(userId)) : null);
      })
      .catch(() => setNote('Couldn’t load your calendar link.'));
  }, [userId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(undefined);
    try {
      await work();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const makeLink = () =>
    run(async () => {
      const made = await request('/me/calendar', { method: 'POST', schema: NewCalendarFeed });
      const url = calendarFeedUrl(API_URL, made.token);
      await secureStorage.set(keyFor(userId), url);
      setFeed(made);
      setLink(url);
    });

  const replace = async () => {
    const ok = await confirmAction(
      'Make a new link?',
      'The old link stops working, so calendars using it stop updating. Add the new one to them.',
      'New link',
    );
    if (ok) await makeLink();
  };

  const stop = async () => {
    const ok = await confirmAction('Stop sharing?', 'The link stops working and your calendars stop updating.', 'Stop sharing');
    if (!ok) return;
    await run(async () => {
      await request('/me/calendar', { method: 'DELETE' });
      await secureStorage.set(keyFor(userId), null);
      setFeed({ active: false, includeUntimed: false, createdAt: null, lastFetchedAt: null });
      setLink(null);
    });
  };

  const setUntimed = (on: boolean) =>
    run(async () => {
      setFeed(await request('/me/calendar', { method: 'PATCH', body: { includeUntimed: on }, schema: CalendarFeed }));
    });

  const open = (url: string) => void Linking.openURL(url).catch(() => setNote('Couldn’t open that. Copy the link instead.'));

  if (!feed) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Body style={{ fontSize: 13 }}>
        See every trip, timed stop and booking in Google or Apple Calendar. It keeps itself up to date as plans change.
      </Body>
      {!feed.active ? (
        <Button
          label="Add my trips to my calendar"
          variant="outline"
          icon={<Feather name="calendar" size={16} color={colors.ink} />}
          onPress={() => void makeLink()}
          loading={busy}
        />
      ) : (
        <>
          <View style={styles.warning}>
            <Feather name="eye" size={14} color={colors.coralInk} />
            <Body style={{ flex: 1, fontSize: 13, color: colors.coralInk }}>
              Anyone with this link can see your trip plans. Share it only with your own calendar.
            </Body>
          </View>
          {link ? (
            <>
              <Button label="Add to Google Calendar" onPress={() => open(googleCalendarUrl(link))} />
              <Button label="Add to Apple or another calendar" variant="outline" onPress={() => open(webcalUrl(link))} />
              <Button
                label="Copy link"
                variant="ghost"
                icon={<Feather name="copy" size={16} color={colors.accent} />}
                onPress={() =>
                  void Clipboard.setStringAsync(link).then(() => setNote('Copied. Paste it into your calendar’s “add by URL”.'))
                }
              />
            </>
          ) : (
            <Body style={{ fontSize: 13 }}>
              Your calendar link is on, but it was made on another device. To add it to a calendar from here, make a new
              link (the old one stops working).
            </Body>
          )}
          <View style={styles.setting}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.settingTitle}>Include stops without a time</Text>
              <Body style={{ fontSize: 13 }}>As all-day items on their day.</Body>
            </View>
            <Switch
              accessibilityLabel="Include stops without a time"
              value={feed.includeUntimed}
              disabled={busy}
              onValueChange={(on) => void setUntimed(on)}
              trackColor={{ true: colors.accent, false: colors.lineStrong }}
            />
          </View>
          <Body style={{ fontSize: 12 }}>
            {feed.lastFetchedAt ? `A calendar last checked it ${ago(feed.lastFetchedAt)}.` : 'No calendar has read it yet.'} Calendars
            check every few hours, so changes can take a while to show.
          </Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button label="New link" variant="ghost" onPress={() => void replace()} disabled={busy} style={{ minHeight: 40 }} />
            <Button label="Stop sharing" variant="ghost" onPress={() => void stop()} disabled={busy} style={{ minHeight: 40 }} />
          </View>
        </>
      )}
      {note ? <Body style={{ fontSize: 13, color: colors.accentInk }}>{note}</Body> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.coralSoft },
  setting: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  settingTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
