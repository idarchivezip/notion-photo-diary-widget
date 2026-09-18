import { getConnection, notionHeaders, PLAN_LIMITS } from "../lib/notionConnection.js";

function toRichText(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 2000) chunks.push(text.slice(i, i + 2000));
  return (chunks.length ? chunks : [""]).map((c) => ({ text: { content: c } }));
}

function pageToEntry(page) {
  const props = page.properties;
  return {
    text: (props["일기"]?.rich_text || []).map((t) => t.plain_text).join(""),
    photos: (props["사진"]?.files || []).map((f) => ({
      url: f.external?.url || f.file?.url,
      name: f.name,
    })),
  };
}

async function findPageForDate(conn, date) {
  const queryRes = await fetch(`https://api.notion.com/v1/databases/${conn.databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(conn.accessToken),
    body: JSON.stringify({ filter: { property: "날짜", date: { equals: date } } }),
  });
  const data = await queryRes.json();
  if (!queryRes.ok) throw new Error(JSON.stringify(data));
  return data.results?.[0] || null;
}

export default async function handler(req, res) {
  const token = req.query.w;
  const conn = await getConnection(token);
  if (!conn) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  try {
    if (req.method === "GET") {
      const { start, end } = req.query;
      const queryRes = await fetch(`https://api.notion.com/v1/databases/${conn.databaseId}/query`, {
        method: "POST",
        headers: notionHeaders(conn.accessToken),
        body: JSON.stringify({
          filter: {
            and: [
              { property: "날짜", date: { on_or_after: start } },
              { property: "날짜", date: { on_or_before: end } },
            ],
          },
          page_size: 100,
        }),
      });
      const data = await queryRes.json();
      if (!queryRes.ok) throw new Error(JSON.stringify(data));

      const entries = {};
      for (const page of data.results) {
        const date = page.properties["날짜"]?.date?.start;
        if (date) entries[date.slice(0, 10)] = pageToEntry(page);
      }
      const limit = PLAN_LIMITS[conn.plan || "free"];
      res.status(200).json({ entries, plan: conn.plan || "free", photoLimit: limit });
      return;
    }

    if (req.method === "PATCH") {
      const { date, text, addPhoto, removePhoto } = req.body;
      if (!date) {
        res.status(400).json({ error: "date_required" });
        return;
      }

      let page = await findPageForDate(conn, date);
      const limit = PLAN_LIMITS[conn.plan || "free"];

      if (addPhoto) {
        const existingCount = page?.properties?.["사진"]?.files?.length || 0;
        if (existingCount >= limit) {
          res.status(403).json({ error: "plan_limit_reached", limit });
          return;
        }
      }

      const properties = {};
      if (typeof text === "string") properties["일기"] = { rich_text: toRichText(text) };

      if (addPhoto || removePhoto) {
        let files = page?.properties?.["사진"]?.files || [];
        if (removePhoto) files = files.filter((f) => (f.external?.url || f.file?.url) !== removePhoto.url);
        if (addPhoto) files = [...files, { type: "external", name: addPhoto.name || "photo", external: { url: addPhoto.url } }];
        properties["사진"] = { files };
      }

      if (!page) {
        const createRes = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: notionHeaders(conn.accessToken),
          body: JSON.stringify({
            parent: { database_id: conn.databaseId },
            properties: { 날짜: { date: { start: date } }, ...properties },
          }),
        });
        page = await createRes.json();
        if (!createRes.ok) throw new Error(JSON.stringify(page));
        res.status(200).json(pageToEntry(page));
        return;
      }

      if (Object.keys(properties).length) {
        const updateRes = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: "PATCH",
          headers: notionHeaders(conn.accessToken),
          body: JSON.stringify({ properties }),
        });
        page = await updateRes.json();
        if (!updateRes.ok) throw new Error(JSON.stringify(page));
      }
      res.status(200).json(pageToEntry(page));
      return;
    }

    res.status(405).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
