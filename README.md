# 절세 점검 — 연말정산 절세 월간 점검

> 연말정산은 12월에 챙기면 이미 늦습니다.
> 매달 카드 사용액, 연금저축·IRP 납입액, 의료비·교육비 같은 공제 항목을 기록하면
> **"올해 공제 한도까지 얼마 남았는지"** 와 **"무엇을 더 하면 얼마를 돌려받는지"** 알려줍니다.

PC와 휴대폰 어디서나 아이콘으로 실행하는 설치형 웹앱(PWA)이고, 같은 계정이면 기기끼리 동기화됩니다.
나중에 같은 코드를 Capacitor로 감싸 Play 스토어/App Store 앱으로 출시할 수 있게 만들었습니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 월별 입력 | 신용·체크카드, 전통시장·대중교통·문화, 연금저축·IRP·ISA 전환, 월세·청약, 의료비, 교육비, 보험료, 기부금 |
| 연간 예상 | 아직 입력 안 한 달의 카드 사용액·월세를 평균으로 채워 연말 결과를 미리 계산 |
| 카드 최적화 | 총급여 25% 문턱까지는 신용카드, 넘은 뒤에는 체크카드(30%). 결제수단만 바꿨을 때 줄어드는 세금 계산 |
| 연금 권장액 | 900만 원 한도까지 남은 금액, 남은 달 수로 나눈 월 납입액. **결정세액이 0원이 되는 지점까지만** 권장 |
| 부족분 알림 | 지난달 입력 누락, 문턱 미달, 11~12월 마감 알림. 달력(.ics)에 매달 반복 일정 등록 |
| 세금 추정 | 근로소득공제 → 과세표준 → 산출세액 → 세액공제 → 결정세액 → 환급액. 표준세액공제가 유리하면 자동 선택 |
| 작년 점검 | 홈택스에서 작년 지급명세서를 보고 놓친 공제를 체크하는 첫 단계 안내 |
| 동기화 | Google 또는 이메일 로그인 → PC·휴대폰 실시간 동기화. 오프라인에서도 입력 가능 |
| 업데이터 | 새 버전을 배포하면 앱에 "새 버전" 배너가 뜨고 버튼 한 번으로 적용. 재설치 불필요 |

## 사용자: 설치하고 실행하기

배포된 주소(예: `https://<아이디>.github.io/<저장소>/`)에 접속한 뒤:

- **Windows/Mac PC** — Chrome·Edge 주소창 오른쪽의 **설치** 아이콘 클릭 → 바탕화면에 생긴 **절세점검** 아이콘을 **두 번 클릭**해 실행
- **Android** — Chrome 메뉴(⋮) → **앱 설치**(또는 홈 화면에 추가) → 홈 화면 아이콘 탭
- **iPhone/iPad** — Safari **공유** 버튼 → **홈 화면에 추가** → 홈 화면 아이콘 탭

앱 안 **설정 → 앱 설치**에도 같은 안내와 설치 버튼이 있습니다.

## 개발자: 로컬 실행 · 테스트

```bash
npm start        # http://localhost:5173 에서 실행 (빌드 과정 없음)
npm test         # 세금 계산·동기화 병합·버전 일치 테스트
```

순수 HTML/CSS/JavaScript(ES 모듈)라 빌드 도구가 필요 없습니다. `app/` 폴더가 그대로 배포됩니다.

## 배포 (둘 중 하나)

### A. GitHub Pages (가장 간단)

1. 이 저장소 **Settings → Pages → Source** 를 **GitHub Actions** 로 선택
2. `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml` 이 테스트 후 자동 배포
3. 주소: `https://tlsgusdlf33.github.io/A15/`

> 비공개(private) 저장소에서 Pages를 쓰려면 GitHub 유료 플랜이 필요합니다. 그 경우 B를 쓰세요.

### B. Firebase Hosting (동기화와 같은 프로젝트에서 무료로)

```bash
npm i -g firebase-tools
firebase login
firebase use --add            # 아래에서 만든 Firebase 프로젝트 선택
firebase deploy               # app/ 폴더 + firestore.rules 배포
```

## 동기화(Firebase) 설정

설정하기 전까지 앱은 **이 기기에만 저장** 모드로 동작합니다(설정 → 백업 내보내기/가져오기로 옮기기 가능).

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 만들기 (무료 Spark 요금제로 충분)
2. **빌드 → Authentication → 시작하기** → 로그인 방법에서 **Google**, **이메일/비밀번호** 사용 설정
3. **Authentication → 설정 → 승인된 도메인**에 배포 주소 도메인 추가 (예: `tlsgusdlf33.github.io`)
4. **빌드 → Firestore Database → 데이터베이스 만들기** (위치: `asia-northeast3` 서울 권장)
5. **Firestore → 규칙** 탭에 저장소의 `firestore.rules` 내용을 붙여넣고 게시 (또는 `firebase deploy --only firestore:rules`)
6. **프로젝트 설정 → 내 앱 → 웹 앱 추가** → 표시되는 `firebaseConfig` 값을 `app/js/firebase-config.js` 에 붙여넣기
7. 버전을 올려 배포 (`npm run bump -- patch "동기화 켜기"` 후 커밋·푸시)

`firebaseConfig` 값은 웹에 공개돼도 되는 식별자입니다. 데이터는 `firestore.rules` 로 **본인 계정만** 읽고 쓸 수 있게 막혀 있습니다.
데이터 경로: `users/{uid}/years/{연도}`. 기기마다 섹션(내 정보·각 월·작년 점검)별로 더 최근에 고친 쪽을 채택해 병합합니다.

## 업데이트 배포하기 (사용자는 재설치 불필요)

```bash
npm run bump -- patch "카드 공제 한도 수정" "화면 개선"   # 또는 minor / major / 1.2.0
git commit -am "v1.0.1" && git push
```

`bump` 가 `app/version.json`, `app/js/version.js`, `app/sw.js`, `package.json` 의 버전을 한 번에 올립니다.
배포되면 사용자의 앱이 켜질 때(또는 1시간마다, 화면으로 돌아올 때) 새 버전을 내려받고
**"새 버전 vX.Y.Z이 있어요 — 지금 업데이트"** 배너를 띄웁니다. 데이터는 그대로 유지됩니다.

## 세법이 바뀌면

모든 세법 수치(공제율·한도·세율표)는 `app/js/core/rules.js` 한 곳에 연도별로 있습니다.
새 귀속연도는 `RULES` 에 연도를 추가하고, 바뀐 숫자만 덮어쓰면 됩니다. 규칙이 없는 연도는 가장 최근 규칙으로 계산하고 화면에 그 사실을 표시합니다.
수정 후 `npm test` → `npm run bump` → 푸시.

> 현재 값은 2026년 귀속 기준으로 정리했습니다. 세법은 매년 바뀌니 출시 전과 매년 초에 국세청 안내와 대조해 주세요.

## 모바일 앱으로 출시 · 수익화

[docs/ROADMAP.md](docs/ROADMAP.md) 에 Capacitor로 Android/iOS 앱 만들기, 앱 업데이트 전략, 수익화 모델과 출시 체크리스트를 정리했습니다.

## 폴더 구조

```
app/                      ← 배포되는 웹앱 전체 (Capacitor webDir)
  index.html              화면 뼈대
  manifest.webmanifest    설치 정보 (이름·아이콘·바로가기)
  sw.js                   서비스 워커: 오프라인 실행 + 업데이트
  version.json            최신 버전·변경 내역 (업데이터가 확인)
  css/style.css           라이트/다크 테마
  icons/                  앱 아이콘 (npm run icons 로 PNG 재생성)
  js/app.js               화면·이벤트
  js/store.js             로컬 저장소 (오프라인 우선)
  js/sync.js              Firebase 로그인·동기화
  js/updater.js           새 버전 감지·적용
  js/reminders.js         달력 알림(.ics), 앱 알림
  js/core/rules.js        연도별 세법 수치  ← 세법 개정 시 수정
  js/core/tax-engine.js   세금 계산·추천 엔진 (DOM 무관, 테스트 대상)
  js/core/fields.js       월별 입력 항목 정의
  js/core/merge.js        기기 간 병합 규칙
tests/                    node:test 단위 테스트
scripts/bump-version.mjs  버전 올리기
scripts/make-icons.mjs    SVG → PNG 아이콘
firebase.json, firestore.rules, capacitor.config.json
```

## 주의

근로소득만 있는 직장인을 기준으로 한 **추정 계산**이며 세무 자문이 아닙니다.
맞벌이 부부의 공제 배분, 종합소득·사업소득, 기부금 소득 한도, 주택자금 차입금 공제 등은 반영하지 않거나 단순화했습니다.
최종 판단은 국세청(홈택스) 안내로 확인하세요.
