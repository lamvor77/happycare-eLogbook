// Supabase 응답을 위한 최소 도메인 타입. 실제 DB 스키마 전체를 생성한 것이
// 아니라, 화면에서 실제로 읽는 컬럼만 담고 있다. 쿼리의 select 절이 이 타입의
// 부분집합만 반환하는 경우가 많으므로, 사용하는 곳에서는 필요에 따라
// `Pick<...>`으로 좁혀서 쓴다.

export interface Hospital {
  hospital_id: string;
  hospital_name: string;
  hospital_address: string | null;
  hospital_phone: string | null;
  hospital_code: string | null;
  qr_token: string | null;
  status: string;
}

export interface Caregiver {
  caregiver_id: string;
  caregiver_name: string;
  phone: string | null;
}

export interface CaseCaregiver {
  case_caregiver_id: string;
  case_id: string;
  caregiver_id: string;
  relationship: string;
  is_primary_caregiver: boolean;
  is_current_caregiver: boolean;
  status: string;
  caregivers?: Caregiver | null;
}

export interface CaseRecord {
  case_id: string;
  case_no: string | null;
  registration_no: string | null;
  source_type: string | null;
  family_code: string;
  patient_name: string;
  patient_birth_date: string | null;
  patient_phone: string | null;
  patient_gender: string | null;
  diagnosis_name: string | null;
  room_no: string | null;
  insurance_company: string | null;
  accident_type: string | null;
  accident_type_etc: string | null;
  planner_name: string | null;
  planner_phone: string | null;
  care_start_date: string | null;
  care_end_date: string | null;
  memo: string | null;
  status: string;
  hospital_id: string;
  created_at: string;
  hospitals?: Hospital | null;
  case_caregivers?: CaseCaregiver[];
}

export interface CareLog {
  log_id: string;
  case_id: string;
  caregiver_id: string;
  hospital_id: string | null;
  care_date: string;
  meal_assist: boolean;
  move_assist: boolean;
  toilet_assist: boolean;
  hygiene_assist: boolean;
  position_change: boolean;
  memo: string | null;
  relationship: string | null;
  writer_name: string | null;
  signature_name: string | null;
  location_status: string;
  latitude: number | null;
  longitude: number | null;
  location_checked_at: string | null;
  location_failure_reason: string | null;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  cases?:
    | (Pick<CaseRecord, "case_id" | "case_no" | "patient_name" | "room_no"> & {
        hospitals?: Pick<Hospital, "hospital_name"> | null;
      })
    | null;
}

export interface CaseHistoryEntry {
  history_id: string;
  case_id: string;
  history_type: string;
  title: string | null;
  action: string | null;
  description: string | null;
  actor: string | null;
  created_at: string;
}
