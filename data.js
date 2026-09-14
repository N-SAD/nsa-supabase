const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SECRET = process.env.NSA_SECRET || 'NSA2026';

if (!global._nsa_tokens) global._nsa_tokens = new Map();
const TOKENS = global._nsa_tokens;

const STORES = ['articles', 'clients', 'commandes', 'livraisons', 'devis'];

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token');
}

function auth(req) {
    const token = req.headers['x-token'];
    if (!token) return false;
    const exp = TOKENS.get(token);
    return exp && Date.now() < exp;
}

async function sb(method, table, body, params) {
    params = params || '';
    const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };
    if (method === 'POST') headers['Prefer'] = 'return=representation';
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    const text = await r.text();
    return text ? JSON.parse(text) : [];
}

module.exports = async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = req.url || '';
    const parts = url.split('?')[0].split('/').filter(Boolean);

    // POST /api/login
    if (url.includes('/api/login') || req.query.action === 'login') {
        const body = req.body || {};
        const pwd = body.password || '';
        if (pwd !== SECRET) return res.status(401).json({ error: 'Mot de passe incorrect' });
        const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        TOKENS.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
        return res.json({ token, ok: true });
    }

    if (!auth(req)) return res.status(401).json({ error: 'Non autorise' });

    const action = req.query.action || '';
    const store = req.query.store || '';

    // GET /api/ping
    if (action === 'ping' || url.includes('/api/ping')) {
        const stats = {};
        for (const s of STORES) {
            try { const rows = await sb('GET', s, null, '?select=id'); stats[s] = rows.length; }
            catch(e) { stats[s] = 0; }
        }
        return res.json({ ok: true, stats });
    }

    // POST /api/import/:store
    if (action === 'import' && store) {
        if (!STORES.includes(store)) return res.status(404).json({ error: 'Store inconnu' });
        const body = req.body || {};
        const items = body[store] || body.items || [];
        let added = 0, updated = 0;

        // Charger tous les existants pour éviter les doublons
        const existants = await sb('GET', store, null, '?select=id,data,numero&limit=10000');

        for (const item of items) {
            const numero = item.numero || null;
            const refArticle = item.reference || null;
            const codeClient = item.code || null;
            try {
                // Chercher un doublon existant
                let existing = null;
                if (numero) {
                    existing = existants.find(x => x.numero === numero);
                }
                if (!existing && store === 'articles' && refArticle) {
                    existing = existants.find(x => (x.data || {}).reference === refArticle);
                }
                if (!existing && store === 'clients' && codeClient) {
                    existing = existants.find(x => (x.data || {}).code === codeClient);
                }

                if (existing) {
                    await sb('PATCH', store, { data: item, numero, updated_at: new Date().toISOString() }, `?id=eq.${existing.id}`);
                    updated++;
                } else {
                    await sb('POST', store, { data: item, numero, source: item.source || 'pc' });
                    added++;
                    // Ajouter au cache local pour éviter doublons dans le même import
                    existants.push({ id: Date.now(), data: item, numero });
                }
            } catch(e) { console.error(e.message); }
        }
        return res.json({ ok: true, added, updated });
    }

    // GET /api/export/:store
    if (action === 'export' && store) {
        if (!STORES.includes(store)) return res.status(404).json({ error: 'Store inconnu' });
        const rows = await sb('GET', store, null, '?select=data,numero,source,created_at&order=created_at.desc&limit=10000');
        const items = (rows || []).map(r => ({ ...(r.data || {}), _created: r.created_at }));
        return res.json({ store, [store]: items, count: items.length });
    }

    // GET /api/mobile/:store (sans photos)
    if (action === 'mobile' && store) {
        if (!STORES.includes(store)) return res.status(404).json({ error: 'Store inconnu' });
        const CHAMPS = {
            articles: ['reference','designation','descriptionCourte','codeBarres','categorie','composition','couleur','taille','prixAchat','prixVente','tva','conditionnement','stock','fournisseur'],
            clients: ['code','nom','contact','adresse1','cp','ville','telephone','email','conditionsPaiement','familleClient','remise'],
        };
        const rows = await sb('GET', store, null, '?select=data&order=created_at.desc&limit=10000');
        const champs = CHAMPS[store];
        const items = (rows || []).map((r, i) => {
            const d = r.data || {};
            if (!champs) return d;
            const safe = { id: i + 1 };
            for (const k of champs) {
                const v = d[k];
                if (v == null) continue;
                if (typeof v === 'string' && v.startsWith('data:')) continue;
                if (typeof v !== 'object') safe[k] = v;
            }
            return safe;
        });
        return res.json({ store, [store]: items, count: items.length });
    }

    return res.status(400).json({ error: 'Action inconnue', url, action, store });
};
