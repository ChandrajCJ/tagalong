// Adds what app.json can't hold: Firebase's google-services.json (Android
// push) comes from an EAS secret file in cloud builds, so it never lands in
// this public repo. Locally, drop the file next to this one (it's gitignored).
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(local) ? './google-services.json' : undefined);
  return {
    ...config,
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
  };
};
