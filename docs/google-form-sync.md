# 구글폼 연동(Apps Script) 가이드

`app/api/google-form-sync/route.ts`는 구글폼 응답을 `cases` 테이블에 upsert하는
엔드포인트입니다. 시크릿 헤더(`x-happycare-sync-secret`)가 일치해야만 동작합니다.

## API 개요

- URL 예시: `https://<배포도메인>/api/google-form-sync`
- Method: `POST`
- Header: `x-happycare-sync-secret: <GOOGLE_FORM_SYNC_SECRET 값>`
- Body: JSON (`registration_no` 필수, 그 외 `patient_name`, `patient_birth_date` 등)

### 전달 필드 (`GoogleFormSyncBody`, `app/api/google-form-sync/route.ts` 기준)

| 필드 | 필수 | 형식 | 비고 |
| --- | --- | --- | --- |
| `registration_no` | **필수** | 문자열 | `cases.registration_no` upsert 키 |
| `family_code`, `case_no` | 선택 | 문자열 | 없으면 서버가 자동 생성 |
| `patient_name` | 선택(사실상 필요) | 문자열 | |
| `patient_birth_date` | 선택 | **완전한 날짜 문자열(예: `"1950-01-01"`, 기존 방식) 또는 6자리 숫자(`"500101"`, QR 등록과 통일된 신규 방식)** | 6자리로 보낼 경우 아래 `patient_birth_century`를 반드시 함께 보내야 한다 |
| `patient_birth_century` | `patient_birth_date`가 6자리일 때만 필수 | `"1900"` 또는 `"2000"` | 6자리만으로는 세기를 알 수 없어 서버가 임의로 추정하지 않는다 |
| `patient_phone`, `patient_gender`, `diagnosis_name`, `room_no` | 선택 | 문자열 | |
| `insurance_company`, `accident_type`, `accident_type_etc` | 선택 | 문자열(자유 입력) | 실제 구글폼의 선택 옵션 목록은 이 저장소에서 확인할 수 없어 강제 목록으로 검증하지 않는다 |
| `planner_name`, `planner_phone` | 선택 | 문자열 | |
| `care_start_date`, `care_end_date` | 선택 | 날짜 문자열 | |
| `memo`, `status` | 선택 | 문자열 | `status` 생략 시 `"입원중"` |

**간병인 관련 필드는 없다.** 이 엔드포인트는 `caregivers`/`case_caregivers`/
`case_consents`를 전혀 생성하지 않는다 — `cases` 행만 upsert한다. 즉
**구글폼은 간병인 주민등록번호(전체 13자리든 무엇이든)를 이 엔드포인트로
전달하지 않으며, 서버도 그런 필드를 받지 않는다.** 구글폼으로 등록된
사례에 간병인을 연결하려면 그 사례의 `family_code`로 `/case-join`(가족
코드 필요)을 별도로 진행해야 한다. 자세한 비교는
`docs/registration-field-mapping.md` 참고.

향후 Apps Script가 간병인 정보까지 함께 보내도록 확장하려면, 이 엔드포인트에
단순히 `caregivers.insert`를 추가하지 말 것 — QR 등록(`register_case_v3`)과
동일하게 caregiver/case_caregiver/case_consents 생성이 원자적으로 묶여야
하고, 주민등록번호는 `lib/caregiver-resident-number.ts`로 암호화해서만
저장해야 한다(`docs/privacy-data-policy.md` 3절). 이 문서는 그 변경이
실제로 이뤄지기 전까지는 위 필드 목록이 유효함을 명시한다.

## Apps Script에서 시크릿을 안전하게 저장하는 방법

시크릿 값을 스크립트 코드에 직접 적지 말고, Apps Script의
`PropertiesService`(스크립트 속성)에 저장한 뒤 코드에서 읽어옵니다.

1. Apps Script 편집기 좌측 메뉴 **프로젝트 설정 → 스크립트 속성**으로 이동합니다.
2. 속성 이름 `HAPPYCARE_SYNC_SECRET`, 값에는 서버의 `GOOGLE_FORM_SYNC_SECRET`과
   동일한 값을 입력합니다.
3. 코드에서는 아래처럼 값을 읽어서 사용합니다. **시크릿 값을 소스 코드에 직접
   적지 않습니다.**

```javascript
// Apps Script 예시 - 잘못된 방법 (사용 금지)
// const SECRET = "실제시크릿값"; // 절대 이렇게 하드코딩하지 않는다.

// 올바른 방법: 스크립트 속성에서 읽기
function getSyncSecret() {
  return PropertiesService.getScriptProperties().getProperty(
    "HAPPYCARE_SYNC_SECRET"
  );
}

function syncFormResponseToHappycare(payload) {
  const response = UrlFetchApp.fetch(
    "https://<배포도메인>/api/google-form-sync",
    {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-happycare-sync-secret": getSyncSecret(),
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );

  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  handleSyncResponse(status, body);
}
```

## HTTP 상태별 처리

| 상태 코드 | 의미 | Apps Script에서 할 일 |
| --- | --- | --- |
| 200 | 성공. `case_id`, `case_no`, `family_code` 반환 | 정상 처리, 필요 시 반환값을 시트에 기록 |
| 400 | 요청 본문에 `registration_no`가 없음 | 폼 매핑 오류로 보고 전송 데이터 확인 |
| 401 | 시크릿 헤더가 없거나 값이 일치하지 않음 | 스크립트 속성의 `HAPPYCARE_SYNC_SECRET` 값과 서버의 `GOOGLE_FORM_SYNC_SECRET` 값이 같은지 확인 |
| 500 | 서버에 `GOOGLE_FORM_SYNC_SECRET`이 설정되지 않았거나 내부 오류 | 서버 배포 환경변수 설정을 관리자에게 확인 요청 |

```javascript
function handleSyncResponse(status, body) {
  if (status === 200) {
    return; // 성공
  }

  if (status === 400) {
    throw new Error("요청 데이터 오류: " + body.error);
  }

  if (status === 401) {
    throw new Error("인증 실패: 시크릿 값을 확인하세요.");
  }

  throw new Error("서버 오류(" + status + "): " + body.error);
}
```

> 이 문서에는 실제 시크릿 값을 적지 않습니다. 실제 값은 서버 배포 환경변수와
> Apps Script 스크립트 속성에만 저장하세요.
