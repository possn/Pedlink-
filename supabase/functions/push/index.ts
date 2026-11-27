// Envia as notificações do PedLink para os telemóveis (Web Push).
// Chamada pela base de dados (trigger em public.notificacoes) com um segredo partilhado.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SEGREDO = Deno.env.get('PUSH_SEGREDO') ?? '';
webpush.setVapidDetails('mailto:pedlinkhff@gmail.com', Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !SEGREDO || req.headers.get('x-pedlink-segredo') !== SEGREDO) {
    return new Response('forbidden', { status: 403 });
  }
  const { id } = await req.json().catch(() => ({}));
  if (!id) return new Response('sem id', { status: 400 });

  const { data: n, error } = await sb.from('notificacoes').select('id, user_id, texto, link').eq('id', id).maybeSingle();
  if (error || !n) return new Response('notificação não encontrada', { status: 404 });
  const { data: subs } = await sb.from('push_subscricoes').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);

  // No ecrã bloqueado não mostrar texto clínico: "Novo caso PL-… (prioridade): motivo" -> só código e prioridade.
  const corpo = String(n.texto).replace(/^(Novo caso [^:]+):[\s\S]*$/, '$1').slice(0, 180);
  const payload = JSON.stringify({ title: 'PedLink', body: corpo, url: n.link || '#/notificacoes', tag: n.link || undefined });
  let enviados = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
      enviados++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from('push_subscricoes').delete().eq('id', s.id); // subscrição expirada
      else console.error('push falhou', code);
    }
  }));
  return new Response(JSON.stringify({ enviados }), { headers: { 'Content-Type': 'application/json' } });
});
