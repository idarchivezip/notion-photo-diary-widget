import crypto from "node:crypto";
import { db } from "../../../lib/firebaseAdmin.js";

// 연결만 만들고, 어떤 데이터베이스를 쓸지는 이후 선택 화면(/api/databases)에서 정한다.
export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(302, `/?connect_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !state || state !== req.cookies?.notion_oauth_state) {
    res.status(400).send("잘못된 접근이에요 (state 불일치). 처음부터 다시 연결해주세요.");
    return;
  }

  try {
    const basic = Buffer.from(
      `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
    ).toString("base64");

    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.NOTION_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      res.status(500).send("노션 인증 실패: " + JSON.stringify(tokenData));
      return;
    }

    const workspaceToken = crypto.randomUUID().replace(/-/g, "");
    await db.collection("connections").doc(workspaceToken).set({
      accessToken: tokenData.access_token,
      databaseId: null,
      workspaceName: tokenData.workspace_name || "",
      createdAt: new Date().toISOString(),
    });

    res.setHeader("Set-Cookie", "notion_oauth_state=; Path=/; Max-Age=0");
    res.redirect(302, `/?w=${workspaceToken}&connected=1`);
  } catch (err) {
    res.status(500).send("연결 중 오류가 발생했어요: " + err.message);
  }
}
