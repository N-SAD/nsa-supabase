const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SECRET = process.env.NSA_SECRET || 'NSA2026';

// Tokens en mémoire (partagés entre requêtes via module cache)
if (!global._nsa_tokens) global._nsa_tokens = new Map();
const TOKENS = global._nsa_tokens;

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

async function supabase(method, table, body = null, params = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
    const r = await fetch(url, {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
        const err = await r.text();
        throw new Error(`Supabase ${r.status}: ${err}`);
    }
    const text = await r.text();
    return text ? JSON.parse(text) : [];
}

const STORES = ['articles', 'clients', 'commandes', 'livraisons', 'devis'];

export default async function handler(req, res) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action, store } = req.query;

    // LOGIN
    if (action === 'login') {
        const { password } = req.body || {};
        if (password !== SECRET) return res.status(401).json({ error: 'Mot de passe incorrect' });
        const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        TOKENS.set(token, Date.now() + 7 * 24 * 60 * 60 * 1000);
        return res.json({ token, ok: true });
    }

    // PING
    if (action === 'ping') {
        if (!auth(req)) return res.status(401).json({ error: 'Non autorise' });
        const stats = {};
        for (const s of STORES) {
            try {
                const rows = await supabase('GET', s, null, '?select=id');
                stats[s] = rows.length;
            } catch(e) { stats[s] = 0; }
        }
        return res.json({ ok: true, stats });
    }

    // IMPORT (envoi depuis ERP PC ou mobile)
    if (action === 'import' && store) {
        if (!auth(req)) return res.status(401).json({ error: 'Non autorise' });
        if (!STORES.includes(store)) return res.status(404).json({ error: 'Store inconnu' });
        const items = req.body?.[store] || req.body?.items || [];
        let added = 0, updated = 0;
        for (const item of items) {
            const numero = item.numero || null;
            const source = item.source || 'mobile';
            try {
                // Vérifier si existe déjà par numéro
                if (numero) {
                    const existing = await supabase('GET', store, null, `?numero=eq.${encodeURIComponent(numero)}&select=id`);
                    if (existing.length > 0) {
                        await supabase('PATCH', store, { data: item, updated_at: new Date().toISOString() }, `?id=eq.${existing[0].id}`);
                        updated++;
                        continue;
                    }
                }
                await supabase('POST', store, { data: item, numero, source });
                added++;
            } catch(e) { console.error('Import error:', e.message); }
        }
        return res.json({ ok: true, added, updated });
    }

    // EXPORT (récupération depuis ERP PC ou mobile)
    if (action === 'export' && store) {
        if (!auth(req)) return res.status(401).json({ error: 'Non autorise' });
        if (!STORES.includes(store)) return res.status(404).json({ error: 'Store inconnu' });
        const rows = await supabase('GET', store, null, '?select=data,numero,source,created_at&order=created_at.desc');
        const items = rows.map(r => ({ ...r.data, _supabase_created: r.created_at }));
        return res.json({ type: 'erp-export', store, [store]: items, count: items.length });
    }

    // MOBILE export filtré (sans photos)
    if (action === 'mobile' && store) {
        if (!auth(req)) return res.status(401).json({ error: 'Non autorise' });
        const CHAMPS = {
            articles: ['id','reference','designation','descriptionCourte','codeBarres','categorie','composition','couleur','taille','prixAchat','prixVente','tva','conditionnement','stock','fournisseur','refFournisseur'],
            clients: ['id','code','nom','contact','adresse1','adresse2','cp','ville','telephone','email','conditionsPaiement','familleClient','remise','tvaIntracom'],
        };
        const rows = await supabase('GET', store, null, '?select=data&order=created_at.desc');
        const champs = CHAMPS[store];
        const items = rows.map(r => {
            if (!champs) return r.data;
            const safe = {};
            for (const k of champs) {
                const v = r.data[k];
                if (v !== undefined && v !== null && typeof v === 'string' && !v.startsWith('data:')) safe[k] = v;
                else if (v !== undefined && v !== null && typeof v !== 'object') safe[k] = v;
            }
            return safe;
        });
        return res.json({ store, [store]: items, count: items.length });
    }

    return res.status(400).json({ error: 'Action inconnue' });
}
