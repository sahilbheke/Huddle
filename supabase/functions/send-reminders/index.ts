// Sends the daily "don't break your streak" reminders.
// Runs on a schedule (see README): it claims the reminders due this hour from the
// database (exactly-once) and delivers them through Expo's push service.
//
// Deploy:  supabase functions deploy send-reminders
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Due = {
  token: string;
  platform: string;
  user_id: string;
  space_id: string;
  space_name: string;
  streak: number;
};

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

function message(d: Due) {
  const title = d.space_name;
  const body =
    d.streak > 0
      ? `Keep your ${d.streak}-day streak alive — log today's activity.`
      : `Don't miss today in ${d.space_name}. Log your activity to stay on track.`;
  return { to: d.token, title, body, sound: 'default', priority: 'high', channelId: 'reminders' };
}

Deno.serve(async (req) => {
  // Allow a manual trigger with the service key, and the scheduled call.
  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (!auth.includes(serviceKey)) return new Response('forbidden', { status: 403 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const { data, error } = await supabase.rpc('claim_due_reminders');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const due = (data ?? []) as Due[];
  if (due.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  // Expo accepts up to 100 messages per request.
  const messages = due.map(message);
  const results: unknown[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    results.push(await res.json());
  }
  return new Response(JSON.stringify({ sent: messages.length, results }), { headers: { 'Content-Type': 'application/json' } });
});
