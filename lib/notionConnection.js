import { db } from "./firebaseAdmin.js";

export const NOTION_VERSION = "2022-06-28";

export function isValidToken(token) {
  return typeof token === "string" && /^[a-f0-9]{32}$/.test(token);
}

export async function getConnection(token) {
  if (!isValidToken(token)) return null;
  const snap = await db.collection("connections").doc(token).get();
  return snap.exists ? snap.data() : null;
}

export function notionHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

// 사용할 데이터베이스를 바꾼다. 보기용 링크 문서에도 같이 반영.
export async function setDatabase(token, conn, databaseId) {
  await db.collection("connections").doc(token).update({ databaseId });
  if (conn.viewToken) await db.collection("connections").doc(conn.viewToken).update({ databaseId });
}
