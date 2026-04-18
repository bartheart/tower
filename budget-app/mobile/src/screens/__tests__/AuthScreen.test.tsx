import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AuthScreen from '../AuthScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }: any) => React.createElement(View, null, children),
    Path: () => null,
    G: () => null,
  };
});

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockResetPassword = jest.fn();

jest.mock('../../supabase/client', () => ({
  signInWithEmail: (...args: any[]) => mockSignIn(...args),
  signUpWithEmail: (...args: any[]) => mockSignUp(...args),
  signInWithGoogle: (...args: any[]) => mockSignInWithGoogle(...args),
  supabase: {
    auth: { resetPasswordForEmail: (...args: any[]) => mockResetPassword(...args) },
  },
}));

function fillSignIn(
  getByTestId: ReturnType<typeof render>['getByTestId'],
  email: string,
  password: string,
) {
  fireEvent.changeText(getByTestId('email-input'), email);
  fireEvent.changeText(getByTestId('password-input'), password);
}

beforeEach(() => jest.clearAllMocks());

test('renders email input, password input, and Continue button', () => {
  const { getByTestId, getByText } = render(<AuthScreen />);
  expect(getByTestId('email-input')).toBeTruthy();
  expect(getByTestId('password-input')).toBeTruthy();
  expect(getByText('Continue')).toBeTruthy();
});

test('submit button is disabled when fields are empty', () => {
  const { getByTestId } = render(<AuthScreen />);
  const btn = getByTestId('submit-button');
  expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
});

test('submit button is disabled when password is fewer than 8 characters', () => {
  const { getByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, 'user@example.com', 'short1');
  const btn = getByTestId('submit-button');
  expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
});

test('submit button enables with email and password ≥ 8 characters', () => {
  const { getByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, 'user@example.com', 'secret123');
  const btn = getByTestId('submit-button');
  expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeFalsy();
});

test('calls signInWithEmail with trimmed email and password', async () => {
  mockSignIn.mockResolvedValueOnce({});
  const { getByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, '  user@example.com  ', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('submit-button')); });
  expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'secret123');
});

test('displays error text when sign-in fails', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Network request failed'));
  const { getByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, 'user@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('submit-button')); });
  await waitFor(() =>
    expect(getByTestId('error-text').props.children).toMatch(/network request failed/i),
  );
});

test('clears error text when user edits email', async () => {
  mockSignIn.mockRejectedValueOnce(new Error('Network request failed'));
  const { getByTestId, queryByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, 'user@example.com', 'secret123');
  await act(async () => { fireEvent.press(getByTestId('submit-button')); });
  await waitFor(() => expect(getByTestId('error-text')).toBeTruthy());
  fireEvent.changeText(getByTestId('email-input'), 'other@example.com');
  expect(queryByTestId('error-text')).toBeNull();
});

test('does not fire a second sign-in while the first is in flight', async () => {
  let resolve!: (v: any) => void;
  mockSignIn.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const { getByTestId } = render(<AuthScreen />);
  fillSignIn(getByTestId, 'user@example.com', 'secret123');
  fireEvent.press(getByTestId('submit-button'));
  fireEvent.press(getByTestId('submit-button'));
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

// 13. Failed Google sign-in shows error
test('shows error message when Google sign-in fails', async () => {
  mockSignInWithGoogle.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId, findByTestId } = render(<AuthScreen />);
  await act(async () => { fireEvent.press(getByTestId('google-signin-button')); });
  const errorEl = await findByTestId('error-text');
  expect(errorEl.props.children).toMatch(/network error/i);
});
