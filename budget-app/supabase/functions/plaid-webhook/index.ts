import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const body = await req.json();

  // Only handle transaction sync webhooks
  if (body.webhook_type !== 'TRANSACTIONS' || body.webhook_code !== 'SYNC_UPDATES_AVAILABLE') {
    return new Response('ok', { status: 200 });
  }

  const itemId: string = body.item_id;

  // Find the user whose device has this item_id registered.
  // NOTE: item_id is not stored in Supabase — we broadcast to all registered
  // devices and each device ignores the notification if it doesn't own that item_id.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: prefs } = await supabase
    .from('app_preferences')
    .select('expo_push_token')
    .not('expo_push_token', 'is', null);

  if (!prefs || prefs.length === 0) return new Response('ok', { status: 200 });

  // Send push to all registered devices — each device checks locally if it owns item_id
  await Promise.all(
    prefs.map((pref: { expo_push_token: string }) =>
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: pref.expo_push_token,
          title: 'New transactions',
          body: 'Your accounts have been updated.',
          data: { itemId },
          priority: 'normal',
        }),
      })
    )
  );

  return new Response('ok', { status: 200 });
});
