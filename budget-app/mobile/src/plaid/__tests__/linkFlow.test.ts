import { fetchLinkToken } from '../linkToken';
import { exchangePublicToken } from '../exchangeToken';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-jwt' } },
      }),
    },
  },
}));

global.fetch = jest.fn();

describe('Plaid link flow', () => {
  it('fetchLinkToken calls edge function and returns link_token', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ link_token: 'link-sandbox-abc' }),
    });

    const token = await fetchLinkToken();
    expect(token).toBe('link-sandbox-abc');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('create-link-token'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('exchangePublicToken returns access_token and item_id', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-sandbox-xxx',
        item_id: 'item_abc123',
      }),
    });

    const result = await exchangePublicToken('public-sandbox-token');
    expect(result.accessToken).toBe('access-sandbox-xxx');
    expect(result.itemId).toBe('item_abc123');
  });
});
