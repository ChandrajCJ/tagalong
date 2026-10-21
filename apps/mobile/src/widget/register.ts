import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { widgetsAvailable } from './native';
import { currentView } from './snapshot';

/**
 * Redraws the home-screen widget when it's added, resized, or on Android's
 * 30-minute refresh, from the facts the app last saved. Taps open the app
 * through deep links, so there's nothing to do on a click.
 */
const handler = async ({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) => {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  const { renderTripWidget } = await import('./trip-widget');
  renderWidget(renderTripWidget(widgetInfo.widgetName, await currentView()));
};

export const registerWidgets = () => {
  if (!widgetsAvailable()) return;
  void import('react-native-android-widget').then(({ registerWidgetTaskHandler }) => registerWidgetTaskHandler(handler));
};
