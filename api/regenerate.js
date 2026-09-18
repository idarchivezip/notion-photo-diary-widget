import crypto from "node:crypto";
import { db } from "../lib/firebaseAdmin.js";
import { getConnection } from "../lib/notionConnection.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const { w: oldToken } = req.body || {};
  const conn = await getConnection(oldToken);
  if (!conn) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const newToken = crypto.randomUUID().replace(/-/g, "");
  await db.collection("connections").doc(newToken).set(conn);
  await db.collection("connections").doc(oldToken).delete();

  res.status(200).json({ token: newToken });
}
