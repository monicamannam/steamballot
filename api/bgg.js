// Vercel serverless function -> available at  /api/bgg?id=13
//
// Same idea as /api/steam: this runs on the SERVER, so it can call
// BoardGameGeek's XML API directly (no API key) and dodge the CORS wall
// the browser would otherwise hit. It parses BGG's XML down to the handful
// of fields the board page actually stores, and hands back clean JSON.
//
// BGG sometimes answers a fresh request with HTTP 202 ("queued, try again")
// — we pass that straight through so the page can retry.

export default async function handler(req, res) {
  const id = String(req.query.id || "").replace(/\D/g, "");
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }

  try {
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${id}&stats=1`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/xml" }
    });

    // BGG is still building the response — tell the client to retry shortly.
    if (r.status === 202) {
      res.status(202).json({ retry: true, id });
      return;
    }

    const xml = await r.text();
    const item = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
    if (!item) {
      res.status(404).json({ error: "BGG returned no game for that id", id });
      return;
    }
    const body = item[0];

    // ---- small XML helpers (BGG's response is stable + well-formed) ----
    const attrVal = (tag) => {
      const m = body.match(new RegExp(`<${tag}\\b[^>]*\\bvalue="([^"]*)"`, "i"));
      return m ? decode(m[1]) : "";
    };
    const tagText = (tag) => {
      const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? decode(m[1].trim()) : "";
    };

    // primary name (a game can list several names; we want type="primary")
    const nameM =
      body.match(/<name\b[^>]*type="primary"[^>]*value="([^"]*)"/i) ||
      body.match(/<name\b[^>]*value="([^"]*)"[^>]*type="primary"/i);
    const name = nameM ? decode(nameM[1]) : (attrVal("name") || "");

    const image = tagText("image") || tagText("thumbnail");
    const year = num(attrVal("yearpublished"));
    const minP = num(attrVal("minplayers"));
    const maxP = num(attrVal("maxplayers"));
    const minT = num(attrVal("minplaytime"));
    const maxT = num(attrVal("maxplaytime"));

    // rating + weight live inside <statistics><ratings>…</ratings>
    const ratings = (body.match(/<ratings\b[^>]*>([\s\S]*?)<\/ratings>/i) || [, ""])[1] || body;
    const avgM = ratings.match(/<average\b[^>]*value="([^"]*)"/i);
    const rating = avgM ? round1(parseFloat(avgM[1])) : null;
    const wM = ratings.match(/<averageweight\b[^>]*value="([^"]*)"/i);
    let weight = wM ? round1(parseFloat(wM[1])) : null;
    if (!weight) weight = null; // BGG returns 0 when it has no weight data

    const poll = parsePlayerPoll(body);

    // game details barely change — cache hard at the edge
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      id,
      name,
      image,
      year_published: year,
      rating,                         // BGG community average, 0–10 (or null)
      weight,                         // complexity 1–5 (or null if unknown)
      min_players: minP,
      max_players: maxP,
      min_playtime: minT,
      max_playtime: maxT,
      recommended_players: poll.recommended, // array of counts, e.g. ["2","3","4"]
      best_players: poll.best                // single best count, e.g. "3" (or "")
    });
  } catch (e) {
    res.status(500).json({ error: "fetch failed", detail: String((e && e.message) || e) });
  }
}

/* suggested_numplayers is a community poll: for each player count, votes for
   Best / Recommended / Not Recommended. We treat a count as recommended when
   the positive votes outweigh the "not recommended" ones, and pick the single
   count with the most "Best" votes as the headline. */
function parsePlayerPoll(body) {
  const poll = body.match(/<poll\b[^>]*name="suggested_numplayers"[^>]*>([\s\S]*?)<\/poll>/i);
  if (!poll) return { recommended: [], best: "" };
  const rows = [];
  const re = /<results\b[^>]*numplayers="([^"]*)"[^>]*>([\s\S]*?)<\/results>/gi;
  let m;
  while ((m = re.exec(poll[1]))) {
    const count = m[1], inner = m[2];
    const votes = (label) => {
      const v = inner.match(new RegExp(`value="${label}"[^>]*?numvotes="([^"]*)"`, "i"));
      return v ? (parseInt(v[1], 10) || 0) : 0;
    };
    rows.push({ count, best: votes("Best"), rec: votes("Recommended"), not: votes("Not Recommended") });
  }
  const recommended = rows
    .filter((r) => r.best + r.rec > r.not && r.best + r.rec > 0)
    .map((r) => r.count); // XML order is already 1,2,3,… so this stays sorted

  let best = "", bestVotes = 0;
  for (const r of rows) if (r.best > bestVotes) { bestVotes = r.best; best = r.count; }
  return { recommended, best };
}

function num(s) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
function round1(n) { return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
