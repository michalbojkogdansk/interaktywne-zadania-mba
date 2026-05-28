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

    // ─── GET routes ───────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      if (path === '/admin/list-groups') {
        const adminKey = request.headers.get('X-Admin-Key');
        if (adminKey !== env.ADMIN_KEY) return err('Unauthorized', 403);
        const list = await env.MBA_GROUPS.list();
        const groups = await Promise.all(
          list.keys.map(async (key) => {
            const value = await env.MBA_GROUPS.get(key.name, 'json');
            return { password: key.name, ...value };
          })
        );
        return ok({ groups });
      }
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.json();

      // ─── /verify-group ────────────────────────────────────────────────────
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
        return ok({ valid: true, groupName: group.name });
      }

      // ─── /admin/create-group ──────────────────────────────────────────────
      if (path === '/admin/create-group') {
        const adminKey = request.headers.get('X-Admin-Key') || body.adminKey;
        if (adminKey !== env.ADMIN_KEY) return err('Unauthorized', 403);
        const { password, name, startDate, endDate } = body;
        if (!password || !name || !startDate || !endDate)
          return err('Wymagane pola: password, name, startDate, endDate');
        const existing = await env.MBA_GROUPS.get(password, 'json');
        if (existing) return err('To hasło jest już zajęte');
        await env.MBA_GROUPS.put(password, JSON.stringify({
          name, startDate, endDate, active: true, createdAt: new Date().toISOString()
        }));
        return ok({ success: true, message: `Grupa "${name}" utworzona` });
      }

      // ─── /admin/toggle-group ──────────────────────────────────────────────
      if (path === '/admin/toggle-group') {
        const adminKey = request.headers.get('X-Admin-Key') || body.adminKey;
        if (adminKey !== env.ADMIN_KEY) return err('Unauthorized', 403);
        const { password, active } = body;
        const group = await env.MBA_GROUPS.get(password, 'json');
        if (!group) return err('Grupa nie istnieje', 404);
        group.active = active;
        await env.MBA_GROUPS.put(password, JSON.stringify(group));
        return ok({ success: true });
      }

      // ─── /admin/delete-group ──────────────────────────────────────────────
      if (path === '/admin/delete-group') {
        const adminKey = request.headers.get('X-Admin-Key') || body.adminKey;
        if (adminKey !== env.ADMIN_KEY) return err('Unauthorized', 403);
        const { password } = body;
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
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(groqBody),
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          const text = data.choices[0].message.content;
          const geminiFormat = { candidates: [{ content: { parts: [{ text }] } }] };
          return new Response(JSON.stringify(geminiFormat), {
            status: 200,
            headers: cors,
          });
        }
        return new Response(JSON.stringify(data), { status: response.status, headers: cors });
      }

      // ─── /verify-access ───────────────────────────────────────────────────
      if (path === '/verify-access') {
        const { code } = body;
        const valid = code === env.ACCESS_CODE;
        return new Response(JSON.stringify({ valid }), { status: 200, headers: cors });
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

      // ─── /private-issue ───────────────────────────────────────────────────
      if (path === '/private-issue') {
        const { code, ...issueData } = body;
        if (code !== env.ACCESS_CODE) return err('Nieprawidłowy kod dostępu', 403);
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
