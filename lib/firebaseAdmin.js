import admin from "firebase-admin";

// Vercel 서버리스 함수는 콜드 스타트마다 모듈을 새로 로드할 수 있어, admin.apps.length로
// 이미 초기화된 앱이 있는지 확인 후 재사용합니다 (중복 초기화 방지).
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

export const db = admin.firestore();
