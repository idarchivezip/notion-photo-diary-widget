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
