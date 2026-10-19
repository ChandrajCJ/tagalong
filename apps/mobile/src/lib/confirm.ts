import { Alert, Platform } from 'react-native';

/**
 * Asks "are you sure?" before something that can't be undone. The web build
 * has no native alert with buttons, so it uses the browser's own.
 */
export const confirmAction = (title: string, message: string, action: string): Promise<boolean> => {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: action, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
};
