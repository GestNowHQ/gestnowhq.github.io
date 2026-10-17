// Builds the Android "frame" around the site (a Trusted Web Activity): the same app, opened full screen,
// with the GestNow name and icon, installed from Google Play. Run by .github/workflows/android.yml.
// Usage: node gerar.js <output folder> <version code>   (ICON_BASE = where to fetch the icons; default the live site)
'use strict';
const { TwaGenerator, TwaManifest, ConsoleLog } = require('@bubblewrap/core');
const OUT = process.argv[2] || 'build/twa';
const CODE = Number(process.argv[3] || 1);
const SITE = 'gestnowhq.github.io';
const ICONS = process.env.ICON_BASE || `https://${SITE}/icons`;
const manifest = new TwaManifest({
  packageId: 'com.gestnowhq.app',
  host: SITE,
  name: 'GestNow',
  launcherName: 'GestNow',
  display: 'standalone',
  orientation: 'portrait',
  themeColor: '#0E4A4B',
  themeColorDark: '#0E4A4B',
  navigationColor: '#0E4A4B',
  navigationColorDark: '#0E4A4B',
  backgroundColor: '#0E4A4B',
  enableNotifications: false,
  startUrl: '/',
  iconUrl: `${ICONS}/icon-512.png`,
  maskableIconUrl: `${ICONS}/maskable-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: './chave-upload.jks', alias: 'upload' },   // signing happens outside this build
  appVersionCode: CODE,
  appVersion: `1.0.${CODE}`,
  fallbackType: 'customtabs',
  enableSiteSettingsShortcut: false,
  minSdkVersion: 24,
  features: {},
  shortcuts: [],
  generatorApp: 'gestnow',
});
new TwaGenerator().createTwaProject(OUT, manifest, new ConsoleLog('twa'))
  .then(() => console.log(`Android project ready in ${OUT} (version ${CODE})`))
  .catch((e) => { console.error(e); process.exit(1); });
