import { notionHeaders } from "./notionConnection.js";

// 날짜(date)는 필수, 나머지는 없으면 자동 추가. 칸 이름이 다른 데이터베이스는 안내만 함.
const EXTRA = { 일기: "rich_text", 사진: "files", 기분: "number" };
const TYPE_LABEL = { date: "날짜", rich_text: "텍스트", files: "파일과 미디어", number: "숫자" };

export const EXTRA_PROPERTIES = Object.fromEntries(Object.entries(EXTRA).map(([name, type]) => [name, { [type]: {} }]));

export function dbTitle(database) {
  return (database.title || []).map((t) => t.plain_text).join("") || "제목 없음";
}

export function inspectDatabase(database) {
  const props = database.properties || {};
  if (!props["날짜"]) return { ok: false, missing: [], problem: "'날짜'라는 이름의 날짜 칸이 필요해요." };
  if (props["날짜"].type !== "date") return { ok: false, missing: [], problem: `'날짜' 칸이 ${TYPE_LABEL.date} 유형이어야 해요.` };

  const missing = [];
  for (const [name, type] of Object.entries(EXTRA)) {
    if (!props[name]) missing.push(name);
    else if (props[name].type !== type) {
      return { ok: false, missing: [], problem: `'${name}' 칸이 ${TYPE_LABEL[type]} 유형이어야 해요.` };
    }
  }
  return { ok: true, missing, problem: null };
}

// 연결한 페이지 안에 새 다이어리 데이터베이스와 예시 행을 만든다. 데이터베이스 id 반환.
export async function createDiaryDb(accessToken) {
  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({ filter: { property: "object", value: "page" }, page_size: 1 }),
  });
  const parentPage = (await searchRes.json()).results?.[0];
  if (!parentPage) throw new Error("데이터베이스를 만들 페이지를 찾지 못했어요. 노션 연결 화면에서 페이지를 하나 선택했는지 확인해주세요.");

  const dbRes = await fetch("https://api.notion.com/v1/databases", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPage.id },
      title: [{ type: "text", text: { content: "포토 다이어리" } }],
      description: [{ type: "text", text: { content: "행을 추가해서 날짜·사진·일기·기분(1~5)을 입력하면 포토 다이어리 위젯에 표시돼요. 사진은 '사진' 칸에 파일로 올리세요. 캘린더로 보면 편해요: 위쪽 '+' → 보기 추가 → 캘린더 → 날짜 속성 '날짜'." } }],
      properties: { 이름: { title: {} }, 날짜: { date: {} }, ...EXTRA_PROPERTIES },
    }),
  });
  const dbData = await dbRes.json();
  if (!dbRes.ok) throw new Error("데이터베이스 생성 실패: " + JSON.stringify(dbData));

  // 입력 방법을 보여주는 예시 행. 실패해도 진행.
  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(accessToken),
    body: JSON.stringify({
      parent: { database_id: dbData.id },
      properties: {
        이름: { title: [{ text: { content: "예시 (지우고 새로 써도 돼요)" } }] },
        날짜: { date: { start: new Date().toISOString().slice(0, 10) } },
        일기: { rich_text: [{ text: { content: "이렇게 날짜·일기·기분(1~5)을 적고, 사진 칸에 사진을 올리면 위젯에 보여요." } }] },
        기분: { number: 5 },
      },
    }),
  }).catch(() => {});

  return dbData.id;
}
