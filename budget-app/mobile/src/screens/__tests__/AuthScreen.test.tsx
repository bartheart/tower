import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AuthScreen from '../AuthScreen';

// Mock safe area insets
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock supabase auth functions
const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithGoogle = jest.fn();

jest.mock('../../supabase/client', () => ({
  signInWithEmail: (...args: any[]) => mockSignIn(...args),
  signUpWithEmail: (...args: any[]) => mockSignUp(...args),
  signInWithGoogle: (...args: any[]) => mockSignInWithGoogle(...args),
  supabase: { auth: { resetPasswordForEmail: jest.fn() } },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
  isErrorWithCode: jest.fn((e: any) => typeof e?.code === 'string'),
}));

function fillForm(
  getByTestId: ReturnType<typeof render>['getByTestId'],
  email: string,
  password: string
) {
  fireEvent.changeText(getByTestId('email-input'), email);
  fireEvent.changeText(getByTestId('password-input'), password);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// 1. Renders email input, password input, and Continue button
test('renders email input, password input, and Continue button', () => {
  const { getByTestId, getByText } = render(<AuthScreen />);
  expect(getByTestId('email-input')).toBeTruthy();
  expect(getByTestId('password-input')).toBeTruthy();
  expect(getByText('Continue')).toBeTruthy();
});

// 2. Continue button is disabled when fields are empty
test('Continue button is disabled when fields are empty', () => {
  const { getByTestId } = render(<AuthScreen />);
  const button = getByTestId('continue-button');
  expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBe(true);
});

// 3. Continue button is disabled when password is too short
test('Continue button is disabled when password is fewer than 6 characters', () => {
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'user@example.com', '12345');
  const button = getByTestId('continue-button');
  expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBe(true);
});

// 4. Continue button enables when email and valid password provided
test('Continue button enables when email and password (≥6 chars) are provided', () => {
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'user@example.com', 'secret123');
  const button = getByTestId('continue-button');
  expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBeFalsy();
});

// 5. Calls signInWithEmail on submit
test('calls signInWithEmail with trimmed email and password', async () => {
  mockSignIn.mockResolvedValueOnce({});
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, '  user@example.com  ', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('continue-button')); });
  expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'secret123');
});

// 6. Falls back to signUpWithEmail when sign-in returns "Invalid login credentials"
test('falls back to signUpWithEmail when sign-in returns invalid credentials error', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Invalid login credentials'));
  mockSignUp.mockResolvedValueOnce({});
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'new@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('continue-button')); });
  expect(mockSignUp).toHaveBeenCalledWith('new@example.com', 'secret123');
});

// 7. Shows error message when signIn fails with non-credentials error
test('displays error message when signIn fails with a non-credentials error', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Network request failed'));
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'user@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('continue-button')); });
  await waitFor(() => expect(getByTestId('error-message').props.children).toMatch(/network request failed/i));
});

// 8. Shows error message when sign-up also fails
test('displays error message when signUp also fails after signIn fallback', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Invalid login credentials'));
  mockSignUp.mockRejectedValueOnce(new Error('Password should be at least 6 characters'));
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'new@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('continue-button')); });
  await waitFor(() =>
    expect(getByTestId('error-message').props.children).toMatch(/password/i)
  );
});

// 9. Error clears when user types in email or password
test('clears error message when user edits email or password', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Network request failed'));
  const { getByTestId, queryByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'user@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('continue-button')); });
  await waitFor(() => expect(getByTestId('error-message')).toBeTruthy());
  // Typing clears the error
  fireEvent.changeText(getByTestId('email-input'), 'other@example.com');
  expect(queryByTestId('error-message')).toBeNull();
});

// 10. No double-submit: pressing Continue twice only fires once
test('does not fire a second sign-in request while the first is in flight', async () => {
  let resolve!: (v: any) => void;
  mockSignIn.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const { getByTestId } = render(<AuthScreen />);
  fillForm(getByTestId, 'user@example.com', 'secret123');
  fireEvent.press(getByTestId('continue-button'));
  fireEvent.press(getByTestId('continue-button'));
  await act(async () => { resolve({}); });
  expect(mockSignIn).toHaveBeenCalledTimes(1);
});

// 11. Google button is visible on sign-in screen
test('renders Google sign-in button on sign-in screen', () => {
  const { getByTestId } = render(<AuthScreen />);
  expect(getByTestId('google-signin-button')).toBeTruthy();
});

// 12. Pressing Google button calls signInWithGoogle
test('calls signInWithGoogle when Google button is pressed', async () => {
  mockSignInWithGoogle.mockResolvedValueOnce(undefined);
  const { getByTestId } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByTestId('google-signin-button')); });
  expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
});

// 13. Cancelled Google sign-in shows no error
test('shows no error when Google sign-in is cancelled', async () => {
  const cancelError = Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' });
  mockSignInWithGoogle.mockRejectedValueOnce(cancelError);
  const { getByTestId, queryByTestId } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByTestId('google-signin-button')); });
  expect(queryByTestId('error-text')).toBeNull();
});

// 14. Failed Google sign-in shows error
test('shows error message when Google sign-in fails', async () => {
  mockSignInWithGoogle.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId, findByTestId } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByTestId('google-signin-button')); });
  const errorEl = await findByTestId('error-text');
  expect(errorEl.props.children).toMatch(/google sign-in failed/i);
});
