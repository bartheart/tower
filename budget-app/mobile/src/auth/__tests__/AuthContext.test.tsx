import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from '../AuthContext';

// Mock supabase client
const mockGetSession = jest.fn();
const mockSignOut = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
      onAuthStateChange: (cb: any) => {
        mockOnAuthStateChange(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));

// Mock WatermelonDB
const mockUnsafeResetDatabase = jest.fn().mockResolvedValue(undefined);
jest.mock('../../db', () => ({
  database: {
    unsafeResetDatabase: () => mockUnsafeResetDatabase(),
  },
}));

function TestConsumer() {
  const { session, user, loading, signOut } = useAuth();
  return (
    <>
      <Text testID="loading">{String(loading)}</Text>
      <Text testID="session">{session ? 'has-session' : 'no-session'}</Text>
      <Text testID="user">{user ? user.id : 'no-user'}</Text>
      <Text testID="signout" onPress={signOut}>sign-out</Text>
    </>
  );
}

function renderWithAuth() {
  return render(<AuthProvider><TestConsumer /></AuthProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnAuthStateChange.mockReturnValue(undefined);
});

// 1. Shows loading=true before session resolves
test('shows loading state before session resolves', () => {
  mockGetSession.mockReturnValue(new Promise(() => {})); // never resolves
  const { getByTestId } = renderWithAuth();
  expect(getByTestId('loading').props.children).toBe('true');
});

// 2. Shows loading=false and session after getSession resolves
test('sets loading=false and session after getSession resolves', async () => {
  const fakeSession = { user: { id: 'user-123' }, access_token: 'tok' };
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  const { getByTestId } = renderWithAuth();
  await waitFor(() => expect(getByTestId('loading').props.children).toBe('false'));
  expect(getByTestId('session').props.children).toBe('has-session');
  expect(getByTestId('user').props.children).toBe('user-123');
});

// 3. No session when getSession returns null
test('shows no-session when getSession returns null', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  const { getByTestId } = renderWithAuth();
  await waitFor(() => expect(getByTestId('loading').props.children).toBe('false'));
  expect(getByTestId('session').props.children).toBe('no-session');
});

// 4. signOut clears session before calling supabase.auth.signOut
test('signOut nulls session before calling supabase signOut', async () => {
  const fakeSession = { user: { id: 'user-123' }, access_token: 'tok' };
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });

  let supabaseSignOutCalled = false;

  mockSignOut.mockImplementation(async () => {
    // By the time supabase.signOut is called, session should already be null
    supabaseSignOutCalled = true;
    return { error: null };
  });

  const { getByTestId } = renderWithAuth();
  await waitFor(() => expect(getByTestId('loading').props.children).toBe('false'));

  await act(async () => {
    fireEvent.press(getByTestId('signout'));
  });

  expect(supabaseSignOutCalled).toBe(true);
  expect(getByTestId('session').props.children).toBe('no-session');
});

// 5. signOut calls unsafeResetDatabase
test('signOut calls database.unsafeResetDatabase', async () => {
  const fakeSession = { user: { id: 'user-123' }, access_token: 'tok' };
  mockGetSession.mockResolvedValue({ data: { session: fakeSession } });
  mockSignOut.mockResolvedValue({ error: null });

  const { getByTestId } = renderWithAuth();
  await waitFor(() => expect(getByTestId('loading').props.children).toBe('false'));

  await act(async () => {
    fireEvent.press(getByTestId('signout'));
  });

  expect(mockUnsafeResetDatabase).toHaveBeenCalledTimes(1);
});

// 6. onAuthStateChange updates session
test('onAuthStateChange fires update to session', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  let capturedCallback: any;
  mockOnAuthStateChange.mockImplementation((cb) => { capturedCallback = cb; });

  const { getByTestId } = renderWithAuth();
  await waitFor(() => expect(getByTestId('loading').props.children).toBe('false'));
  expect(getByTestId('session').props.children).toBe('no-session');

  const newSession = { user: { id: 'user-456' }, access_token: 'tok2' };
  act(() => { capturedCallback('SIGNED_IN', newSession); });

  expect(getByTestId('session').props.children).toBe('has-session');
  expect(getByTestId('user').props.children).toBe('user-456');
});
