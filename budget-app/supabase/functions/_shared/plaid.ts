const PLAID_BASE_URLS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export function plaidBaseUrl(): string {
  return PLAID_BASE_URLS[Deno.env.get('PLAID_ENV') ?? 'sandbox'];
}

export function plaidHeaders() {
  return {
    'Content-Type': 'application/json',
    'PLAID-CLIENT-ID': Deno.env.get('PLAID_CLIENT_ID')!,
    'PLAID-SECRET': Deno.env.get('PLAID_SECRET')!,
  };
}
