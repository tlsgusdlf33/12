# 세법 설정 연간 검토 체크리스트

세법 수치는 `app/rules/{연도}.yaml` 에만 있습니다. **매년 1월**(국세청 「연말정산 신고안내」가 나온 뒤) 아래 순서로 검토합니다.

## 1. 새 연도 파일 만들기

```yaml
# app/rules/2027.yaml
year: 2027
extends: 2026        # 바뀐 값만 아래에 적는다
meta:
  status: draft
  reviewedAt: null
  note: 2027년 귀속 기준입니다. 최종 판단은 국세청(홈택스) 안내로 확인하세요.
  uncertain: []
```

`app/rules/index.json` 의 `years` 에 연도를 추가하고, `app/sw.js` 의 `ASSETS` 에도 `rules/2027.yaml` 을 추가합니다. 빠뜨리면 `npm test` 가 실패합니다.

## 2. 항목별 대조 (출처: 국세청 신고안내 · 국가법령정보센터)

- [ ] 근로소득공제 구간·공제율·한도 (`earnedIncomeDeduction`)
- [ ] 종합소득세율·누진공제 (`taxBrackets`)
- [ ] 근로소득세액공제 공제율·총급여 구간별 한도 (`earnedIncomeCredit`)
- [ ] 신용카드 공제: 문턱 25%, 결제수단별 공제율, 기본·추가 한도, 자녀 수 한도 상향, 문화비 총급여 기준 (`card`)
- [ ] 연금계좌: 연금저축 600만·합산 900만, 공제율 15%/12%, 총급여 기준, ISA 전환 (`pension`)
- [ ] 의료비: 문턱 3%, 일반 부양가족 한도, 난임·미숙아 공제율 (`medical`)
- [ ] 교육비 한도 (`education`), 보험료 (`insurance`), 기부금 (`donation`)
- [ ] 월세: 총급여 기준, 한도, 공제율 (`rent`)
- [ ] 주택청약: 총급여 기준, 납입 한도, 공제율 (`housingSubscription`)
- [ ] 자녀·출산·혼인 세액공제 (`childCredit`, `marriageCredit`), 표준세액공제
- [ ] 4대보험 요율과 국민연금 기준소득월액 상·하한 (`socialInsurance`)
- [ ] 한시 특례(소비 증가분 추가 공제 등)가 새로 생겼는지 → 있으면 앱 기능 추가가 필요한지 판단

## 3. 시뮬레이터 검증

앱 **작년 점검 → 시뮬레이터 검증**에 실제 원천징수영수증 값을 넣어 오차가 **5% 이내**인지 확인합니다.
넘으면 어느 공제에서 차이가 나는지 공제 현황 화면의 계산 과정과 원천징수영수증을 줄별로 비교합니다.

## 4. 마무리

- [ ] `meta.status: verified`, `meta.reviewedAt: 검토한 날짜`, 해결된 `uncertain` 항목 삭제
- [ ] `npm test`
- [ ] `npm run bump -- minor "2027년 세법 반영"` → 커밋·푸시 (업데이터로 모든 기기에 반영)
