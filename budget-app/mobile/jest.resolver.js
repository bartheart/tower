/**
 * Custom Jest resolver to force the non-native WatermelonDB SQLite dispatcher
 * when running in a Node/Jest environment. jest-expo sets platform=ios, which
 * causes Jest to resolve `makeDispatcher/index.native.js` (which requires
 * NativeModules), instead of `makeDispatcher/index.js` (which uses sqlite-node).
 */
const path = require('path');

module.exports = (moduleName, options) => {
  // Intercept any resolution that would land on the native makeDispatcher.
  // The require from sqlite/index.js is `./makeDispatcher` (relative).
  // The basedir will be something like .../adapters/sqlite
  const isRelativeMakeDispatcher =
    moduleName === './makeDispatcher' &&
    options.basedir &&
    options.basedir.includes('watermelondb/adapters/sqlite');

  const isAbsoluteMakeDispatcher =
    moduleName.includes('makeDispatcher') && moduleName.includes('watermelondb');

  if (isRelativeMakeDispatcher || isAbsoluteMakeDispatcher) {
    return path.resolve(
      __dirname,
      'node_modules/@nozbe/watermelondb/adapters/sqlite/makeDispatcher/index.js'
    );
  }

  // Fall back to the default resolver for everything else, but WITHOUT
  // platform-specific extensions that would cause .native.js to be preferred
  // over .js for non-RN code running in Node.
  return options.defaultResolver(moduleName, options);
};
