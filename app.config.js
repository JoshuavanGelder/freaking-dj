// Het buildnummer van GitHub Actions wordt het versienummer van de app,
// zodat elke nieuwe APK netjes over de vorige heen installeert.
const build = Number(process.env.GITHUB_RUN_NUMBER || 1);

module.exports = {
  expo: {
    name: 'Freaking DJ',
    slug: 'freaking-dj',
    scheme: 'freakingdj',
    version: `0.1.${build}`,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: '#121212',
    android: {
      package: 'nl.freakingdj.app',
      versionCode: build,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#121212',
      },
      softwareKeyboardLayoutMode: 'resize',
    },
    plugins: ['expo-font'],
  },
};
