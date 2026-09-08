const SECRET = process.env.NSA_SECRET || 'NSA2026';
const TOKENS = new Map();

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { password } = req.body || {};
    if (password !== SECRET) return res.status(401).json({ error: 'Mot de passe incorrect' });

    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    TOKENS.set(token, expiry);

    return res.status(200).json({ token, ok: true });
}
