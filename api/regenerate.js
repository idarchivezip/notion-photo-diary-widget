import crypto from "node:crypto";
import { db } from "../lib/firebaseAdmin.js";
import { getConnection } from "../lib/notionConnection.js";

// 관리용 링크 재발급. 보기용 링크는 그대로 유지(가리키는 관리용 토큰만 갱신).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const { w: oldToken } = req.body || {};
  const conn = await getConnection(oldToken);
  if (!conn || conn.readOnly) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const newToken = crypto.randomUUID().replace(/-/g, "");
  await db.collection("connections").doc(newToken).set(conn);
  if (conn.viewToken) await db.collection("connections").doc(conn.viewToken).update({ adminToken: newToken });
  await db.collection("connections").doc(oldToken).delete();

  res.status(200).json({ token: newToken });
}
