import crypto from "node:crypto";
import { db } from "../lib/firebaseAdmin.js";
import { getConnection } from "../lib/notionConnection.js";

// 관리용 링크(w)로만 호출 가능. 보기용 링크는 같은 노션 연결을 읽기 전용으로 가리키는 별도 토큰.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const { w, renew } = req.body || {};
  const conn = await getConnection(w);
  if (!conn || conn.readOnly) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  if (conn.viewToken && !renew) {
    res.status(200).json({ token: conn.viewToken });
    return;
  }
  if (conn.viewToken) await db.collection("connections").doc(conn.viewToken).delete();

  const token = crypto.randomUUID().replace(/-/g, "");
  const { viewToken, ...rest } = conn;
  await db.collection("connections").doc(token).set({ ...rest, readOnly: true, adminToken: w });
  await db.collection("connections").doc(w).update({ viewToken: token });
  res.status(200).json({ token });
}
