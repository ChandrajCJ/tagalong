// Expo generates expo-env.d.ts with these on `expo start`; declaring them here
// keeps `tsc` working in CI, where that file doesn't exist.
declare module '*.css';
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
