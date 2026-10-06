// PC ↔ 휴대폰 동기화를 위한 Firebase 설정.
// 비어 있으면 앱은 "이 기기에만 저장" 모드로 동작한다.
// 설정 방법은 README.md 의 "동기화(Firebase) 설정" 참고.
// 아래 값은 웹 앱에 공개되어도 되는 식별자이며, 데이터 보호는 firestore.rules 가 담당한다.

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
