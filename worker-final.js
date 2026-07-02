export default {
  async fetch(request, env) {

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const ok  = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
    const err = (msg, status = 400)  => new Response(JSON.stringify({ error: msg }), { status, headers: cors });

    // ─── Origin guard for admin routes ──────────────────────────────────────
    if (path.startsWith('/admin/')) {
      const origin = request.headers.get('Origin') || '';
      const allowedOrigins = ['https://michalbojkogdansk.github.io'];
      if (!allowedOrigins.includes(origin)) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: cors });
      }
    }

    // ─── Rate limiting helpers ───────────────────────────────────────────────
    async function checkRateLimit(ip) {
      const kvKey = `rl:${ip}`;
      const record = await env.MBA_GROUPS.get(kvKey, 'json');
      if (record && record.blockedUntil && Date.now() < record.blockedUntil) {
        return { blocked: true, secsLeft: Math.ceil((record.blockedUntil - Date.now()) / 1000) };
      }
      return { blocked: false, attempts: record ? record.attempts : 0 };
    }
    async function recordFailedAttempt(ip) {
      const kvKey = `rl:${ip}`;
      const record = await env.MBA_GROUPS.get(kvKey, 'json') || { attempts: 0 };
      const attempts = (record.attempts || 0) + 1;
      const ttl = 900;
      if (attempts >= 5) {
        await env.MBA_GROUPS.put(kvKey, JSON.stringify({ attempts, blockedUntil: Date.now() + ttl * 1000 }), { expirationTtl: ttl });
      } else {
        await env.MBA_GROUPS.put(kvKey, JSON.stringify({ attempts }), { expirationTtl: ttl });
      }
    }
    async function clearRateLimit(ip) {
      await env.MBA_GROUPS.delete(`rl:${ip}`);
    }
    async function verifyAdmin(request, body) {
      const adminKey = request.headers.get('X-Admin-Key') || (body && body.adminKey);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkRateLimit(ip);
      if (rl.blocked) return { ok: false, resp: err(`Za dużo nieudanych prób. Spróbuj za ${rl.secsLeft}s.`, 429) };
      if (adminKey !== env.ADMIN_KEY) {
        await recordFailedAttempt(ip);
        return { ok: false, resp: err('Unauthorized', 403) };
      }
      await clearRateLimit(ip);
      return { ok: true };
    }

    // ─── GET routes ───────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      if (path === '/admin/list-groups') {
        const auth = await verifyAdmin(request, null);
        if (!auth.ok) return auth.resp;
        const list = await env.MBA_GROUPS.list();
        // Filter out rate-limit keys (rl:*) — they are not groups
        const groupKeys = list.keys.filter(k => !k.name.startsWith('rl:'));
        const groups = await Promise.all(
          groupKeys.map(async (key) => {
            const value = await env.MBA_GROUPS.get(key.name, 'json');
            return { password: key.name, ...value };
          })
        );
        return ok({ groups });
      }
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    try {
      const body = await request.json();

      // ─── /verify-group ────────────────────────────────────────────────────
      // Returns group info including allowedExercises
      if (path === '/verify-group') {
        const { password } = body;
        if (!password) return ok({ valid: false, error: 'Brak hasła' });
        const group = await env.MBA_GROUPS.get(password, 'json');
        if (!group) return ok({ valid: false, error: 'Nieprawidłowe hasło grupy' });
        const now   = new Date();
        const start = new Date(group.startDate + 'T00:00:00');
        const end   = new Date(group.endDate   + 'T23:59:59');
        if (!group.active) return ok({ valid: false, error: 'Dostęp dla tej grupy został zamknięty' });
        if (now < start)   return ok({ valid: false, error: 'Dostęp do tej grupy jeszcze nie jest aktywny' });
        if (now > end)     return ok({ valid: false, error: 'Dostęp dla tej grupy wygasł' });
        // allowedExercises: array like ['01','02','03'] or null = all
        return ok({
          valid: true,
          groupName: group.name,
          allowedExercises: group.allowedExercises || null
        });
      }

      // ─── /admin/create-group ──────────────────────────────────────────────
      if (path === '/admin/create-group') {
        const auth = await verifyAdmin(request, body);
        if (!auth.ok) return auth.resp;
        const { password, name, startDate, endDate, allowedExercises } = body;
        if (!password || !name || !startDate || !endDate)
          return err('Wymagane pola: password, name, startDate, endDate');
        const existing = await env.MBA_GROUPS.get(password, 'json');
        if (existing) return err('To hasło jest już zajęte');
        await env.MBA_GROUPS.put(password, JSON.stringify({
          name,
          startDate,
          endDate,
          active: true,
          allowedExercises: allowedExercises || null, // null = dostęp do wszystkich
          createdAt: new Date().toISOString()
        }));
        return ok({ success: true, message: `Grupa "${name}" utworzona` });
      }

      // ─── /admin/update-group ──────────────────────────────────────────────
      if (path === '/admin/update-group') {
        const auth = await verifyAdmin(request, body);
        if (!auth.ok) return auth.resp;
        const { password, allowedExercises } = body;
        const group = await env.MBA_GROUPS.get(password, 'json');
        if (!group) return err('Grupa nie istnieje', 404);
        group.allowedExercises = allowedExercises || null;
        await env.MBA_GROUPS.put(password, JSON.stringify(group));
        return ok({ success: true });
      }

      // ─── /admin/toggle-group ──────────────────────────────────────────────
      if (path === '/admin/toggle-group') {
        const auth = await verifyAdmin(request, body);
        if (!auth.ok) return auth.resp;
        const { password, active } = body;
        const group = await env.MBA_GROUPS.get(password, 'json');
        if (!group) return err('Grupa nie istnieje', 404);
        group.active = active;
        await env.MBA_GROUPS.put(password, JSON.stringify(group));
        return ok({ success: true });
      }

      // ─── /admin/delete-group ──────────────────────────────────────────────
      if (path === '/admin/delete-group') {
        const auth = await verifyAdmin(request, body);
        if (!auth.ok) return auth.resp;
        const { password, confirm_name } = body;
        if (!confirm_name) return err('confirm_name required', 400);
        const stored = await env.MBA_GROUPS.get(password, 'json');
        if (!stored) return err('Group not found', 404);
        if (stored.name !== confirm_name) return err('confirm_name mismatch', 400);
        await env.MBA_GROUPS.delete(password);
        return ok({ success: true });
      }

      // ─── /gemini — proxy do Groq (Llama 3.3 70B) ─────────────────────────
      if (path === '/gemini') {
        const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
        let prompt = '';
        if (body.contents && body.contents[0] && body.contents[0].parts) {
          prompt = body.contents[0].parts[0].text || '';
        } else if (body.prompt) {
          prompt = body.prompt;
        } else {
          prompt = JSON.stringify(body);
        }
        const groqBody = {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1500,
          temperature: 0.7,
        };
        const response = await fetch(groqUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify(groqBody),
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          const text = data.choices[0].message.content;
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200, headers: cors });
        }
        return new Response(JSON.stringify(data), { status: response.status, headers: cors });
      }

      // ─── /verify-access ───────────────────────────────────────────────────
      if (path === '/verify-access') {
        const { code } = body;
        return ok({ valid: code === env.ACCESS_CODE });
      }

      // ─── /verify-nexo ─────────────────────────────────────────────────────
      if (path === '/verify-nexo') {
        const { code } = body;
        return new Response(JSON.stringify({ valid: !!(code && code === env.NEXO_CODE) }), { headers: cors });
      }

      // ─── /get-db-connection ───────────────────────────────────────────────
      if (path === '/get-db-connection') {
        const { code } = body;
        const valid = !!(code && code === env.NEXO_CODE);
        if (!valid) return new Response(JSON.stringify({ valid: false, error: 'Nieprawidłowe hasło.' }), { headers: cors });
        return new Response(JSON.stringify({ valid: true, connectionString: env.DB_CONNECTION_STRING || '' }), { headers: cors });
      }

      // ─── /private-issue ───────────────────────────────────────────────────
      if (path === '/private-issue') {
        const { code, ...issueData } = body;
        let authorized = (code && code === env.ACCESS_CODE);
        if (!authorized && code && env.MBA_GROUPS) {
          const groupData = await env.MBA_GROUPS.get(code);
          authorized = groupData !== null;
        }
        if (!authorized) return err('Nieprawidłowy kod dostępu', 403);
        const response = await fetch('https://api.github.com/repos/michalbojkogdansk/mba-wyniki-prywatne/issues', {
          method: 'POST',
          headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'MBA-Quiz-Worker',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(issueData),
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), { status: response.status, headers: cors });
      }

      // ─── /create-private-repo ─────────────────────────────────────────────
      if (path === '/create-private-repo') {
        const repoResponse = await fetch('https://api.github.com/user/repos', {
          method: 'POST',
          headers: {
            'Authorization': `token ${env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'MBA-Quiz-Worker',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'mba-wyniki-prywatne',
            description: 'Prywatne wyniki testów MBA — tylko dla prowadzącego',
            private: true,
            auto_init: true,
          }),
        });
        const repoData = await repoResponse.json();
        return new Response(JSON.stringify(repoData), { status: repoResponse.status, headers: cors });
      }

      // ─── /github-issue (default) ──────────────────────────────────────────
      const response = await fetch('https://api.github.com/repos/michalbojkogdansk/interaktywne-zadania-mba/issues', {
        method: 'POST',
        headers: {
          'Authorization': `token ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'MBA-Quiz-Worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return new Response(JSON.stringify(data), { status: response.status, headers: cors });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
    }
  },
};
