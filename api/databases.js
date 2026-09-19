import { getConnection, notionHeaders, setDatabase } from "../lib/notionConnection.js";
import { createDiaryDb, dbTitle, EXTRA_PROPERTIES, inspectDatabase } from "../lib/notionDb.js";

const DB_ID = /^[0-9a-f-]{32,36}$/i;

// 관리용 링크 전용: 노션에서 공유된 데이터베이스 목록 / 사용할 데이터베이스 선택 / 새로 만들기
export default async function handler(req, res) {
  const w = req.method === "GET" ? req.query.w : req.body?.w;
  const conn = await getConnection(w);
  if (!conn || conn.readOnly) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  try {
    if (req.method === "GET") {
      const searchRes = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: notionHeaders(conn.accessToken),
        body: JSON.stringify({ filter: { property: "object", value: "database" }, page_size: 50 }),
      });
      const data = await searchRes.json();
      if (!searchRes.ok) throw new Error(JSON.stringify(data));

      const databases = data.results.map((d) => ({ id: d.id, title: dbTitle(d), ...inspectDatabase(d) }));
      res.status(200).json({ databases, current: conn.databaseId || null });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    const { action, databaseId } = req.body;

    if (action === "create") {
      await setDatabase(w, conn, await createDiaryDb(conn.accessToken));
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "select" && DB_ID.test(databaseId || "")) {
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        headers: notionHeaders(conn.accessToken),
      });
      const database = await dbRes.json();
      if (!dbRes.ok) throw new Error("이 데이터베이스에 접근할 수 없어요. 노션 연결 화면에서 공유했는지 확인해주세요.");

      const check = inspectDatabase(database);
      if (!check.ok) {
        res.status(400).json({ error: check.problem });
        return;
      }
      if (check.missing.length) {
        const properties = Object.fromEntries(check.missing.map((name) => [name, EXTRA_PROPERTIES[name]]));
        const patchRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
          method: "PATCH",
          headers: notionHeaders(conn.accessToken),
          body: JSON.stringify({ properties }),
        });
        if (!patchRes.ok) throw new Error("필요한 칸을 추가하지 못했어요: " + (await patchRes.text()));
      }

      await setDatabase(w, conn, databaseId);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "invalid_request" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
