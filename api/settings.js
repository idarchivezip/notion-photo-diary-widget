import { db } from "../lib/firebaseAdmin.js";
import { getConnection } from "../lib/notionConnection.js";

const HEX = /^#[0-9a-f]{6}$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const { w, settings: s } = req.body || {};
  if (!(await getConnection(w))) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  // 화이트리스트로 검증한 값만 저장
  const ok =
    ["light", "dark", "system"].includes(s?.theme) &&
    HEX.test(s?.accent) &&
    (s?.bg === "auto" || HEX.test(s?.bg)) &&
    ["round", "square"].includes(s?.corner) &&
    typeof s?.showRating === "boolean";
  if (!ok) {
    res.status(400).json({ error: "invalid_settings" });
    return;
  }

  const { theme, accent, bg, corner, showRating } = s;
  await db.collection("connections").doc(w).update({ settings: { theme, accent, bg, corner, showRating } });
  res.status(200).json({ ok: true });
}
