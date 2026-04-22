const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

// react-native-ble-plx ships only `main` (no `exports` field). Metro's package
// exports resolver can't find it. Force-resolve to the package's main entry.
const blePlxEntry = path.resolve(
  __dirname,
  'node_modules/react-native-ble-plx/src/index.js'
);
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-ble-plx') {
    return { type: 'sourceFile', filePath: blePlxEntry };
  }
  if (baseResolveRequest) {
    return baseResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
