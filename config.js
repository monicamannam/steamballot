/* Public browser config comes from Vercel environment variables via /api/config. */
var SUPABASE_URL = "";
var SUPABASE_ANON_KEY = "";

async function loadConfig(){
  const r = await fetch("/api/config", { cache:"no-store" });
  if(!r.ok) throw new Error("Config request failed with HTTP " + r.status);
  const cfg = await r.json();
  SUPABASE_URL = cfg.supabaseUrl || "";
  SUPABASE_ANON_KEY = cfg.supabaseAnonKey || "";
  return cfg;
}
