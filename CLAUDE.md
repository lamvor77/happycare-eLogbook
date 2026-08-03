@AGENTS.md

# 해피간병 프로젝트 규칙

## 기술 스택
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase
- Vercel

## 핵심 데이터 구조
- hospitals
- cases
- caregivers
- case_caregivers
- care_logs
- care_log_photos
- case_history

## 기준 구조
- 신규 기능은 patient_id가 아닌 case_id 중심으로 구현한다.
- app/case-care-log/[id]가 신규 간병일지 작성 화면이다.
- app/cases/[id]/care-logs가 통합 일지 조회 화면이다.
- 관리자 PDF는 app/admin/cases/[id]/print에서만 제공한다.

## 위치정보 정책
- 간병일지 화면 진입 시 위치 확인을 자동 시도한다.
- 확인 중에는 저장할 수 없다.
- 성공하면 location_status = checked
- 실패하면 location_status = unavailable
- 실패 시 location_failure_reason을 저장한다.
- 신규 기록에는 not_used를 저장하지 않는다.

## 권한 정책
- 현재 간병인만 간병일지를 작성할 수 있다.
- 가족간병인은 PDF를 내려받을 수 없다.
- 관리자만 PDF 생성 및 출력 가능하다.

## 코딩 규칙
- 파일 전체를 확인한 뒤 수정한다.
- 기존 기능을 임의로 제거하지 않는다.
- any 사용을 가능한 줄인다.
- 수정 후 npm run build를 실행한다.
- 환경변수와 개인정보를 출력하거나 커밋하지 않는다.
- DB 변경이 필요하면 Supabase SQL을 별도 파일로 작성한다.
