// Notifies the other members of a space about a new message or check-in.
// The sender's app calls this right after posting, with the user's access token.
//
// Deploy:  supabase functions deploy notify
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

type Body = { space_id?: string; thread_id?: string; title: string; body: string };

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('unauthorized', { status: 401 });

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad request', { status: 400 });
  }
  if (!payload?.body || (!payload?.space_id && !payload?.thread_id)) return new Response('bad request', { status: 400 });

  // Use the caller's token so the lookup sees them as the member/participant they are.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  // A space message notifies the other members; a direct message notifies the one other person.
  const { data, error } = payload.thread_id
    ? await supabase.rpc('dm_tokens_to_notify', { p_thread: payload.thread_id })
    : await supabase.rpc('tokens_to_notify', { p_space: payload.space_id });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 403 });

  const targets = (data ?? []) as { token: string }[];
  if (targets.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

  const messages = targets.map((t) => ({
    to: t.token,
    title: payload.title?.slice(0, 80) || 'Huddle',
    body: payload.body.slice(0, 160),
    sound: 'default',
    channelId: 'activity',
    // Lets the app clear this chat's notifications once it's read, open the chat on tap,
    // and show a Reply box (the "chat" category) to answer without opening the app.
    data: payload.thread_id ? { thread_id: payload.thread_id } : { space_id: payload.space_id },
    categoryId: 'chat',
  }));
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
