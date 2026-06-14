// Vercel serverless function -> available at  /api/steam?appid=1245620
//
// Vercel auto-detects any file in the /api folder, so no extra config is
// needed. This runs on the SERVER, so it can call Steam's public store API
// directly with no API key and no CORS problem, then hand clean JSON back
// to the page.

export default async function handler(req, res) {
  const appid = String(req.query.appid || "").replace(/\D/g, "");
  if (!appid) {
    res.status(400).json({ error: "missing appid" });
    return;
  }

  try {
    // cc + l help with region-locked / "Coming Soon" pages; a UA avoids some blocks
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`;
    const r = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0" } });
    const json = await r.json();
    const entry = json && json[appid];

    if (!entry || !entry.success || !entry.data) {
      // success:false is common for unreleased/age-gated apps — report it so it's debuggable
      res.status(404).json({ error: "Steam returned no details", appid, steam_success: entry ? entry.success : null });
      return;
    }

    const d = entry.data;
    // cache at Vercel's edge for a day; game details rarely change
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=86400");
    res.status(200).json({
      title: d.name || "",
      description: String(d.short_description || "").replace(/<[^>]*>/g, "").trim().slice(0, 220),
      image: d.header_image || d.capsule_imagev5 || d.capsule_image || ""
    });
  } catch (e) {
    res.status(500).json({ error: "fetch failed", detail: String(e && e.message || e) });
  }
}
