// Runs on Expo's build servers before installing (the "eas-build-pre-install"
// hook): copies Firebase's google-services.json from the EAS secret file
// GOOGLE_SERVICES_JSON to where app.json expects it. The file never lives in
// this public repo, and .fingerprintignore keeps it out of the runtime
// fingerprint so local `eas update` and cloud builds agree.
import { copyFileSync } from 'node:fs';

const source = process.env.GOOGLE_SERVICES_JSON;
if (source) {
  copyFileSync(source, new URL('../google-services.json', import.meta.url));
  console.log('google-services.json is in place');
} else {
  console.log('GOOGLE_SERVICES_JSON is not set: building without Firebase (no Android push)');
}
