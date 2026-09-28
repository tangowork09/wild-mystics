import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tangowork09.wildmystics',
  appName: 'Wild Mystics',
  webDir: 'dist',
  backgroundColor: '#0d0b12',
  android: { backgroundColor: '#0d0b12', allowMixedContent: false },
  ios: { backgroundColor: '#0d0b12', contentInset: 'never', scrollEnabled: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, launchAutoHide: true, backgroundColor: '#0d0b12', showSpinner: false, androidScaleType: 'CENTER_CROP', splashFullScreen: true, splashImmersive: true },
  },
};

export default config;
