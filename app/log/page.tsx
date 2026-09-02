import { supabase } from "@/lib/supabase";

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string; q?: string }>;
}) {
  const { h, q } = await searchParams;

  if (!h && !q) {
    return <main className="p-8">병원 QR 정보가 없습니다.</main>;
  }

  // 개인정보 최소화: 이 화면은 로그인 없이 접근 가능하므로 병원의
  // 최소 식별 정보만 조회한다. 환자 목록은 이 화면에서 보여주지 않는다.
  //
  // hospitals 테이블을 직접 조회하지 않고 SECURITY DEFINER 함수를 쓴다.
  // 테이블을 직접 거르려면 anon에게 qr_token 컬럼 SELECT 권한이 있어야
  // 하는데, 그러면 anon 키로 활성 병원 전체의 QR 토큰을 열거할 수 있다.
  // 함수 안에서 대조하면 토큰을 아는 사람만 자기 병원 정보를 얻는다.
  const { data: hospitals } = await supabase.rpc("get_public_hospital_v2", {
    p_qr_token: q ?? null,
    p_hospital_code: q ? null : (h as string),
  });

  const hospital = hospitals?.[0] ?? null;

  if (!hospital) {
    return <main className="p-8">등록되지 않은 병원입니다.</main>;
  }

  if (hospital.status !== "active") {
    return (
      <main className="p-8">
        계약이 종료되었거나 사용할 수 없는 병원입니다.
      </main>
    );
  }

  const hospitalQuery = q ? `q=${q}` : `h=${h}`;
  const registerHref = `/case-register?${hospitalQuery}`;

  // 공개 채널 주소만 사용한다. 사례/간병인/병원 토큰 등 어떤 식별자도
  // 이 URL에 붙이지 않는다(개인정보/토큰이 카카오로 전달되면 안 된다).
  const kakaoChannelUrl = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL || "";

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <h1 className="text-2xl font-bold mb-2">
            해피간병 전자간병일지
          </h1>

          <p className="text-gray-700 font-bold">
            {hospital.hospital_name}
          </p>

          <p className="text-sm text-gray-700 mt-1">
            {hospital.hospital_address || "-"}
          </p>
        </div>

        {/* 처음 이용 안내 — "5초 안에 어디를 눌러야 하는지"가 목적이다.
            문구는 실제 시스템 동작 범위를 넘지 않는다: 등록 직후 접수
            알림이 가고, 담당자 처리 후 등록 관련 안내가 이어지는 구조라
            "접수 및 등록 관련 안내"로만 말한다("승인 완료" 같은 표현
            금지). */}
        <div className="rounded-lg p-5 bg-[#FFF2F5] border border-[#FFE1E8]">
          <h2 className="font-bold text-[#D94C72] mb-3">처음 이용하시나요?</h2>

          <ol className="space-y-2.5 text-sm text-gray-800 leading-relaxed">
            <li className="flex gap-2">
              <span className="shrink-0 font-bold text-[#EC6A8E]">①</span>
              <span>
                처음 이용하시는 경우{" "}
                <b>간병인 &amp; 환자 최초 등록</b>을 먼저 진행해 주세요.
              </span>
            </li>

            <li className="flex gap-2">
              <span className="shrink-0 font-bold text-[#EC6A8E]">②</span>
              <span>
                등록을 마치면 입력하신 휴대폰 번호로{" "}
                <b className="text-[#D94C72]">카카오 알림톡</b>을 통해 접수 및
                등록 관련 안내를 보내드립니다.
              </span>
            </li>

            <li className="flex gap-2">
              <span className="shrink-0 font-bold text-[#EC6A8E]">③</span>
              <span>등록 후에는 간병일지를 작성할 수 있습니다.</span>
            </li>
          </ol>
        </div>

        {/* 주요 액션 3개 — href/동작은 기존 그대로, 보조 문구만 더한다. */}
        <div className="bg-white rounded-lg shadow p-5 space-y-3">
          <a
            href="/my-cases"
            className="block text-center bg-blue-600 text-white px-4 py-3 rounded-lg"
          >
            <span className="block font-bold">간병일지 작성</span>
            <span className="block text-xs text-blue-100 mt-0.5">
              등록을 마친 간병인이 간병 내용을 기록합니다.
            </span>
          </a>

          <a
            href={registerHref}
            className="block text-center bg-gray-700 text-white px-4 py-3 rounded-lg"
          >
            <span className="block font-bold">간병인 &amp; 환자 최초 등록</span>
            <span className="block text-xs text-gray-300 mt-0.5">
              처음 이용하시는 분은 여기에서 등록해 주세요.
            </span>
          </a>

          <a
            href="/case-join"
            className="block text-center bg-green-600 text-white px-4 py-3 rounded-lg"
          >
            <span className="block font-bold">가족간병인 추가</span>
            <span className="block text-xs text-green-100 mt-0.5">
              함께 간병할 가족을 본인 휴대폰 인증으로 추가합니다.
            </span>
          </a>
        </div>

        {/* 문의 및 안내 — 공개 카카오채널로만 연결한다. 환경변수가 없으면
            영역 자체를 생략한다(깨진 링크를 보여주지 않는다). */}
        {kakaoChannelUrl && (
          <div className="rounded-lg p-5 bg-white border border-[#FFE1E8]">
            <h2 className="font-bold text-sm text-gray-800 mb-2">문의 및 안내</h2>

            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              간병일지 이용방법, 간병종료 후 관련 서류 발급, 수수료 등의
              안내는 해피간병 카카오채널에서 확인하실 수 있습니다.
            </p>

            <a
              href={kakaoChannelUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-center border border-[#EC6A8E] text-[#D94C72] font-bold px-4 py-3 rounded-lg"
            >
              해피간병 카카오채널 바로가기
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
