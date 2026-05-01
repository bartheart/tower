import { fetchLinkToken } from '../linkToken';
import { fetchUpdateLinkToken } from '../linkToken';
import { removePlaidItem } from '../removePlaidItem';
import { exchangePublicToken } from '../exchangeToken';
import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: {
      refreshSession: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}));

jest.mock('../../db', () => ({
  database: {
    get: jest.fn(() => ({
      query: jest.fn(() => ({
        fetch: jest.fn().mockResolvedValue([]),
      })),
    })),
    write: jest.fn(async (fn: () => Promise<void>) => fn()),
  },
}));

const mockRefresh = supabase.auth.refreshSession as jest.Mock;
const mockInvoke  = supabase.functions.invoke as jest.Mock;

const MOCK_SESSION = { session: { access_token: 'mock-jwt' } };

describe('Plaid link flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue({ data: MOCK_SESSION, error: null });
  });

  it('fetchLinkToken calls edge function and returns link_token', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { link_token: 'link-sandbox-abc' }, error: null });

    const token = await fetchLinkToken();
    expect(token).toBe('link-sandbox-abc');
    expect(mockInvoke).toHaveBeenCalledWith('create-link-token');
  });

  it('exchangePublicToken returns only itemId (access_token stored server-side)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { item_id: 'item_abc123' }, error: null });

    const result = await exchangePublicToken('public-sandbox-token');
    expect(result.itemId).toBe('item_abc123');
    expect((result as any).accessToken).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith(
      'exchange-public-token',
      expect.objectContaining({ body: { public_token: 'public-sandbox-token' } }),
    );
  });
});

describe('fetchUpdateLinkToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue({ data: MOCK_SESSION, error: null });
  });

  it('calls create-link-token with item_id body', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { link_token: 'link-sandbox-update' }, error: null });

    const token = await fetchUpdateLinkToken('item_abc123');
    expect(token).toBe('link-sandbox-update');
    expect(mockInvoke).toHaveBeenCalledWith(
      'create-link-token',
      expect.objectContaining({ body: { item_id: 'item_abc123' } }),
    );
  });

  it('throws if no link_token returned', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(fetchUpdateLinkToken('item_abc123')).rejects.toThrow('No link_token');
  });
});

describe('removePlaidItem client helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue({ data: MOCK_SESSION, error: null });
  });

  it('calls remove-plaid-item edge function with item_id', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { success: true }, error: null });

    await removePlaidItem('item_abc123');
    expect(mockInvoke).toHaveBeenCalledWith(
      'remove-plaid-item',
      expect.objectContaining({ body: { item_id: 'item_abc123' } }),
    );
  });

  it('throws on edge function error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('Not found') });
    await expect(removePlaidItem('item_abc123')).rejects.toThrow();
  });
});
