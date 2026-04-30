import * as Notifications from 'expo-notifications';
import { database } from '../../db';
import { supabase } from '../../supabase/client';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(() => ({
      upsert: jest.fn().mockResolvedValue({}),
    })),
  },
}));

jest.mock('../../db', () => ({
  database: {
    get: jest.fn(),
    write: jest.fn(async (fn: () => Promise<void>) => fn()),
  },
}));

const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockDbGet = database.get as jest.Mock;
const mockAddListener = Notifications.addNotificationReceivedListener as jest.Mock;

describe('setupNotificationHandler — ITEM_ERROR type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('sets has_error=true on matching PlaidItem for ITEM_ERROR notification', async () => {
    const mockItem = {
      itemId: 'item_abc',
      hasError: false,
      update: jest.fn(async (fn: (item: any) => void) => { fn(mockItem); }),
    };

    mockDbGet.mockReturnValue({
      query: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue([mockItem]),
      }),
    });

    let capturedListener: ((n: any) => Promise<void>) | undefined;
    mockAddListener.mockImplementation((cb: (n: any) => Promise<void>) => {
      capturedListener = cb;
      return { remove: jest.fn() };
    });

    const { setupNotificationHandler } = require('../backgroundSync');
    setupNotificationHandler();

    expect(capturedListener).toBeDefined();

    await capturedListener!({
      request: {
        content: {
          data: { type: 'ITEM_ERROR', itemId: 'item_abc' },
        },
      },
    });

    expect(mockItem.update).toHaveBeenCalled();
    expect(mockItem.hasError).toBe(true);
  });
});
