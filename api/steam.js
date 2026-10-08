// Vercel serverless function -> available at  /api/steam?appid=1245620
//
// Vercel auto-detects any file in the /api folder, so no extra config is
// needed. This runs on the SERVER, so it can call Steam's public store API
// directly with no API key and no CORS problem, then hand clean JSON back
// to the page.

export default async function handler(req, res) {
  const appid = String(req.query.appid || "").replace(/\D/g, "");
  const fresh = req.query.fresh === "1";
  if (!appid) {
    res.status(400).json({ error: "missing appid" });
    return;
  }

  try {
    // cc + l help with region-locked / "Coming Soon" pages; a UA avoids some blocks
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`;
    const r = await fetch(url, {
      cache: fresh ? "no-store" : "default",
      headers: { "Accept-Language": "en", "User-Agent": "Mozilla/5.0" }
    });
    const json = await r.json();
    const entry = json && json[appid];

    if (!entry || !entry.success || !entry.data) {
      // success:false is common for unreleased/age-gated apps — report it so it's debuggable
      res.status(404).json({ error: "Steam returned no details", appid, steam_success: entry ? entry.success : null });
      return;
    }

    const d = entry.data;
    const price = normalizePrice(d);
    // Game details rarely change, but the manual price refresh should not reuse edge cache.
    res.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=86400, stale-while-revalidate=86400");
    res.status(200).json({
      title: d.name || "",
      description: String(d.short_description || "").replace(/<[^>]*>/g, "").trim().slice(0, 220),
      image: d.header_image || d.capsule_imagev5 || d.capsule_image || "",
      price_initial: price.initial,
      price_final: price.final
    });
  } catch (e) {
    res.status(500).json({ error: "fetch failed", detail: String(e && e.message || e) });
  }
}

function normalizePrice(d) {
  if (d && d.is_free) return { initial: 0, final: 0 };

  const p = d && d.price_overview;
  if (p && Number.isFinite(p.initial) && Number.isFinite(p.final)) {
    return { initial: p.initial, final: p.final };
  }

  // Coming soon, unpriced, and otherwise unavailable Steam prices use the
  // project's placeholder value: $999.
  return { initial: 99900, final: 99900 };
}
