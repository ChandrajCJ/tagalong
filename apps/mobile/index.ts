// The app's entry: Expo Router, plus the Android home-screen widget's task
// handler, which Android can run without the app open.
import 'expo-router/entry';
import { registerWidgets } from './src/widget/register';

registerWidgets();
