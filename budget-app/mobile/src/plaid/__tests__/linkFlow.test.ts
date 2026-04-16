import { fetchLinkToken } from '../linkToken';
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
