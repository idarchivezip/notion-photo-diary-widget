import { getConnection, notionHeaders } from "../lib/notionConnection.js";

// 노션 내부 파일은 ~1시간짜리 임시 주소로 오고, 외부 링크(기존 Cloudinary 사진)는 영구 주소로 옴.
function pageToEntry(page) {
  const props = page.properties;
  return {
    text: (props["일기"]?.rich_text || []).map((t) => t.plain_text).join(""),
    rating: props["기분"]?.number || 0,
    photos: (props["사진"]?.files || []).map((f) => ({ url: f.external?.url || f.file?.url, name: f.name })),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const conn = await getConnection(req.query.w);
  if (!conn) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  if (!conn.databaseId) {
    // 아직 사용할 데이터베이스를 고르지 않은 새 연결
    res.status(200).json({ entries: {}, settings: conn.settings || null, viewOnly: !!conn.readOnly, needsDb: true });
    return;
  }

  try {
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
    // 보기용 링크는 설정을 자기 문서가 아니라 관리용 문서에서 읽어서, 관리 화면에서 바꾼 테마가 바로 반영되게 함.
    const owner = conn.readOnly && conn.adminToken ? await getConnection(conn.adminToken) : conn;
    res.status(200).json({ entries, settings: owner?.settings || null, viewOnly: !!conn.readOnly });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
