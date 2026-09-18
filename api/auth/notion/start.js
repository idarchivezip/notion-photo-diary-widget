import crypto from "node:crypto";

export default function handler(req, res) {
  const state = crypto.randomUUID().replace(/-/g, "");

  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", process.env.NOTION_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", process.env.NOTION_REDIRECT_URI);
  url.searchParams.set("state", state);

  res.setHeader(
    "Set-Cookie",
    `notion_oauth_state=${state}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax`
  );
  res.redirect(302, url.toString());
}
