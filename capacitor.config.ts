import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.carelocal.app',
  appName: 'CareLocal',
  webDir: 'out',
  server: {
    url: 'https://carelocal.co/mobile',
    cleartext: true
  }
};

export default config;
