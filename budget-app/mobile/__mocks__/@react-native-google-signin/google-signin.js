// Automatic mock for @react-native-google-signin/google-signin
// Used by Jest so native module resolution does not fail in test environment.

const GoogleSignin = {
  configure: jest.fn(),
  hasPlayServices: jest.fn().mockResolvedValue(true),
  signIn: jest.fn(),
  signOut: jest.fn(),
  isSignedIn: jest.fn().mockResolvedValue(false),
  getCurrentUser: jest.fn().mockResolvedValue(null),
};

const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

const isErrorWithCode = jest.fn((e) => typeof e?.code === 'string');

module.exports = {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
};
