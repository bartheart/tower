module.exports = {
  preset: 'jest-expo',
  resolver: '<rootDir>/jest.resolver.js',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@nozbe/watermelondb|d3-sankey|@supabase/supabase-js)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Force the non-native (Node.js/sqlite-node) dispatcher in Jest, since
    // jest-expo sets platform=ios which would otherwise resolve .native.js
    '^@nozbe/watermelondb/adapters/sqlite/makeDispatcher(.*)$':
      '<rootDir>/node_modules/@nozbe/watermelondb/adapters/sqlite/makeDispatcher/index.js',
    // Mock native Google Sign-In package (no native bindings in Jest)
    '^@react-native-google-signin/google-signin$':
      '<rootDir>/__mocks__/@react-native-google-signin/google-signin.js',
  },
};
