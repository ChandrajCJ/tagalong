import type { WidgetView } from '@tagalong/shared';
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';
import { dark, light, type Palette } from '@/palette';

/** The widgets' names, as registered in app.json. */
export const SMALL_WIDGET = 'TripCountdown';
export const MEDIUM_WIDGET = 'TripToday';

const hex = (c: string) => c as ColorProp;
const tripLink = (tripId: string, path = '') => ({ uri: `tagalong://trips/${tripId}${path}` });

/** Small (2×2): the next trip's countdown on its cover colour, or "Day 2 of 5" during it. */
function Small({ view, p }: { view: WidgetView; p: Palette }) {
  if (view.kind === 'none') {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel="Tagalong: no trips coming up"
        style={{ height: 'match_parent', width: 'match_parent', padding: 14, borderRadius: 22, backgroundColor: hex(p.surface), justifyContent: 'center' }}
      >
        <TextWidget text="No trips coming up" style={{ fontSize: 15, fontWeight: 'bold', color: hex(p.ink) }} maxLines={2} />
        <TextWidget text="Plan one in Tagalong" style={{ fontSize: 12, color: hex(p.muted) }} maxLines={1} />
      </FlexWidget>
    );
  }
  const line = view.kind === 'before' ? view.countdown : view.day;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={tripLink(view.tripId)}
      accessibilityLabel={`${view.name}, ${line}`}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        padding: 14,
        borderRadius: 22,
        backgroundColor: hex(view.coverColor),
        justifyContent: 'space-between',
      }}
    >
      <TextWidget text={view.name} style={{ fontSize: 16, fontWeight: 'bold', color: hex(p.onCover) }} maxLines={2} truncate="END" />
      <TextWidget text={line} style={{ fontSize: 22, fontWeight: 'bold', color: hex(p.onCover) }} maxLines={1} />
    </FlexWidget>
  );
}

/** Medium (4×2): during a trip, today's next stop and the next booking; before it, the countdown and the packing. */
function Medium({ view, p }: { view: WidgetView; p: Palette }) {
  const frame = {
    height: 'match_parent' as const,
    width: 'match_parent' as const,
    padding: 14,
    borderRadius: 22,
    backgroundColor: hex(p.surface),
    flexGap: 4,
  };
  if (view.kind === 'none') {
    return (
      <FlexWidget clickAction="OPEN_APP" accessibilityLabel="Tagalong: no trips coming up" style={{ ...frame, justifyContent: 'center' }}>
        <TextWidget text="No trips coming up" style={{ fontSize: 16, fontWeight: 'bold', color: hex(p.ink) }} />
        <TextWidget text="Tap to plan one with your friends" style={{ fontSize: 13, color: hex(p.muted) }} />
      </FlexWidget>
    );
  }
  const header = (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 8, width: 'match_parent' }}>
      <FlexWidget style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: hex(view.coverColor) }} />
      <TextWidget text={view.name} style={{ fontSize: 15, fontWeight: 'bold', color: hex(p.ink) }} maxLines={1} truncate="END" />
      <TextWidget text={view.kind === 'before' ? view.countdown : view.day} style={{ fontSize: 13, color: hex(p.accent) }} maxLines={1} />
    </FlexWidget>
  );
  if (view.kind === 'before') {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={tripLink(view.tripId)} accessibilityLabel={`${view.name}, ${view.countdown}`} style={frame}>
        {header}
        <TextWidget text={`Starts ${view.countdown}`} style={{ fontSize: 22, fontWeight: 'bold', color: hex(p.ink) }} maxLines={1} />
        <TextWidget text={view.packed ?? 'Tap for the packing list and plan'} style={{ fontSize: 13, color: hex(p.muted) }} maxLines={1} />
      </FlexWidget>
    );
  }
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={tripLink(view.tripId)} accessibilityLabel={`${view.name}, ${view.day}`} style={frame}>
      {header}
      {view.nextStop ? (
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={tripLink(view.tripId, `/items/${view.nextStop.id}`)}
          accessibilityLabel={`Next: ${view.nextStop.title} at ${view.nextStop.time}, ${view.nextStop.when}`}
          style={{ width: 'match_parent', flexGap: 2 }}
        >
          <TextWidget text={`${view.nextStop.time}  ${view.nextStop.title}`} style={{ fontSize: 17, fontWeight: 'bold', color: hex(p.ink) }} maxLines={1} truncate="END" />
          <TextWidget text={view.nextStop.when} style={{ fontSize: 13, color: hex(p.accent) }} />
        </FlexWidget>
      ) : (
        <TextWidget text="Nothing else timed today" style={{ fontSize: 15, color: hex(p.muted) }} />
      )}
      {view.nextBooking ? (
        <TextWidget text={`${view.nextBooking.title} · ${view.nextBooking.when}`} style={{ fontSize: 13, color: hex(p.muted) }} maxLines={1} truncate="END" />
      ) : null}
    </FlexWidget>
  );
}

/** The widget in both looks; the launcher picks the one matching the phone. */
export const renderTripWidget = (name: string, view: WidgetView) => {
  const Widget = name === SMALL_WIDGET ? Small : Medium;
  return { light: <Widget view={view} p={light} />, dark: <Widget view={view} p={dark} /> };
};
