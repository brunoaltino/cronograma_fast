import { SUPABASE_URL, SUPABASE_ANON_KEY, TABLE_ESTADO, TABLE_RANKING } from "./config.js";

let AUTH = null;

export function getAuth() {
  return AUTH;
}

export function loadSavedSession() {
  try {
    const saved = localStorage.getItem("cb26_auth");
    if (saved) AUTH = JSON.parse(saved);
  } catch (e) {}
  return AUTH;
}

export function saveSession(data) {
  if (!data || !data.access_token) return;
  AUTH = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) - 60,
    user: data.user || (AUTH && AUTH.user) || null
  };
  localStorage.setItem("cb26_auth", JSON.stringify(AUTH));
}

export function clearSession() {
  AUTH = null;
  localStorage.removeItem("cb26_auth");
}

export async function ensureToken() {
  if (!AUTH) return null;
  const now = Math.floor(Date.now() / 1000);
  if (AUTH.expires_at && now < AUTH.expires_at) return AUTH.access_token;
  if (!AUTH.refresh_token) {
    clearSession();
    return null;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: AUTH.refresh_token })
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = await res.json();
    saveSession(data);
    return AUTH.access_token;
  } catch (e) {
    return AUTH.access_token;
  }
}

export async function authLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Falha ao entrar");
  saveSession(data);
}

export async function authSignup(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Falha ao criar conta");
  if (data.access_token) {
    saveSession(data);
    return { logged: true };
  }
  return { logged: false };
}

export async function fetchUserState() {
  const token = await ensureToken();
  if (!token || !AUTH || !AUTH.user) throw new Error("UNAUTH");
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_ESTADO}?user_id=eq.${encodeURIComponent(AUTH.user.id)}&select=estado,atualizado_em`;
  const res = await fetch(url, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + token }
  });
  if (res.status === 401) {
    clearSession();
    throw new Error("UNAUTH");
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0].estado : null;
}

export async function upsertUserState(estado) {
  const token = await ensureToken();
  if (!token || !AUTH || !AUTH.user) throw new Error("UNAUTH");
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_ESTADO}?on_conflict=user_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      user_id: AUTH.user.id,
      estado,
      atualizado_em: new Date().toISOString()
    })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function upsertRanking(metrics) {
  const token = await ensureToken();
  if (!token || !AUTH || !AUTH.user) return;
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_RANKING}?on_conflict=user_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      user_id: AUTH.user.id,
      apelido: metrics.apelido,
      ativo: metrics.ativo,
      dias_concluidos: metrics.dias_concluidos,
      questoes_feitas: metrics.questoes_feitas,
      acerto_geral: metrics.acerto_geral,
      nota_estimada: metrics.nota_estimada,
      atualizado_em: new Date().toISOString()
    })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
}

export async function fetchRankingList() {
  const token = await ensureToken();
  if (!token) throw new Error("UNAUTH");
  const url = `${SUPABASE_URL}/rest/v1/${TABLE_RANKING}?select=user_id,apelido,ativo,dias_concluidos,questoes_feitas,acerto_geral,nota_estimada,atualizado_em&order=nota_estimada.desc,questoes_feitas.desc,dias_concluidos.desc`;
  const res = await fetch(url, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": "Bearer " + token }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}