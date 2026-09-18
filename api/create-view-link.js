import crypto from "node:crypto";
import { db } from "../lib/firebaseAdmin.js";
import { getConnection } from "../lib/notionConnection.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const { w: editToken } = req.body || {};
  const conn = await getConnection(editToken);
  if (!conn || conn.readOnly) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const viewToken = crypto.randomUUID().replace(/-/g, "");
  await db.collection("connections").doc(viewToken).set({ ...conn, readOnly: true });

  res.status(200).json({ token: viewToken });
}
