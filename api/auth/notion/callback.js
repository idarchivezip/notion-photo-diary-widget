import crypto from "node:crypto";
import { db } from "../../../lib/firebaseAdmin.js";
import { notionHeaders } from "../../../lib/notionConnection.js";

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
    const accessToken = tokenData.access_token;

    // 사용자가 연결 시 공유한 페이지 중 하나를 부모로 사용
    const searchRes = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: notionHeaders(accessToken),
      body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 1 }),
    });
    const searchData = await searchRes.json();
    const parentPage = searchData.results?.[0];
    if (!parentPage) {
      res.status(400).send(
        "연결할 페이지를 찾지 못했어요. 노션 연결 화면에서 다이어리를 저장할 페이지를 선택했는지 확인해주세요."
      );
      return;
    }

    const dbRes = await fetch("https://api.notion.com/v1/databases", {
      method: "POST",
      headers: notionHeaders(accessToken),
      body: JSON.stringify({
        parent: { type: "page_id", page_id: parentPage.id },
        title: [{ type: "text", text: { content: "포토 다이어리" } }],
        properties: {
          날짜: { date: {} },
          일기: { rich_text: {} },
          사진: { files: {} },
        },
      }),
    });
    const dbData = await dbRes.json();
    if (!dbRes.ok) {
      res.status(500).send("데이터베이스 생성 실패: " + JSON.stringify(dbData));
      return;
    }

    const workspaceToken = crypto.randomUUID().replace(/-/g, "");
    await db.collection("connections").doc(workspaceToken).set({
      accessToken,
      databaseId: dbData.id,
      workspaceName: tokenData.workspace_name || "",
      plan: "free",
      createdAt: new Date().toISOString(),
    });

    res.setHeader("Set-Cookie", "notion_oauth_state=; Path=/; Max-Age=0");
    res.redirect(302, `/?w=${workspaceToken}&connected=1`);
  } catch (err) {
    res.status(500).send("연결 중 오류가 발생했어요: " + err.message);
  }
}
