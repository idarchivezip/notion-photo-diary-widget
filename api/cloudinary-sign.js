import crypto from "node:crypto";
import { getConnection, notionHeaders, PLAN_LIMITS } from "../lib/notionConnection.js";

export default async function handler(req, res) {
  const { w: token, date } = req.query;
  const conn = await getConnection(token);
  if (!conn) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  if (!date) {
    res.status(400).json({ error: "date_required" });
    return;
  }

  try {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${conn.databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(conn.accessToken),
      body: JSON.stringify({ filter: { property: "날짜", date: { equals: date } } }),
    });
    const data = await queryRes.json();
    if (!queryRes.ok) throw new Error(JSON.stringify(data));

    const existingCount = data.results?.[0]?.properties?.["사진"]?.files?.length || 0;
    const limit = PLAN_LIMITS[conn.plan || "free"];
    if (existingCount >= limit) {
      res.status(403).json({ error: "plan_limit_reached", limit });
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto
      .createHash("sha1")
      .update(`timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`)
      .digest("hex");

    res.status(200).json({
      timestamp,
      signature,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
