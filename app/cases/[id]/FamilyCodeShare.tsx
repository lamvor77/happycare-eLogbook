"use client";

import { useState } from "react";

/**
 * 가족코드 표시 + 복사/공유.
 *
 * 새 가족은 반드시 "본인 휴대폰"으로 등록한다(2026-09-05 UX 정리). 이미
 * 등록된 가족이 자기 기기에서 다른 가족을 추가하는 진입점은 없앴고, 이
 * 화면의 역할은 "가족코드를 전달하는 것"으로 좁혔다.
 *
 * 코드를 손으로 받아쓰면 틀리기 쉬우므로 바로 복사하거나 메신저로 보낼
 * 수 있게 한다.
 *
 * 공유 문구에는 참여 링크(/case-join?code=...)를 함께 담는다 — 받는
 * 사람이 코드를 다시 입력하지 않아도 되고, 그 화면이 코드를 미리
 * 채워 준다(CaseJoinClient가 searchParams의 code를 초기값으로 쓴다).
 *
 * 환자명 등 개인정보는 공유 문구에 넣지 않는다. 코드와 링크만 보낸다.
 */
export default function FamilyCodeShare({
  familyCode,
}: {
  familyCode: string;
}) {
  const [notice, setNotice] = useState("");

  function joinUrl() {
    return `${window.location.origin}/case-join?code=${encodeURIComponent(familyCode)}`;
  }

  function shareText() {
    return `해피간병 가족간병인 참여 안내\n가족코드: ${familyCode}\n${joinUrl()}`;
  }

  /**
   * navigator.clipboard는 보안 컨텍스트(https)에서만 동작하고, 일부
   * 인앱 브라우저에서는 아예 없다. 실패하면 숨긴 textarea + execCommand로
   * 한 번 더 시도한다 — 구식이지만 그런 환경에서 유일하게 되는 방법이다.
   */
  async function copyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // 아래 대체 경로로 넘어간다.
    }

    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  async function handleCopy() {
    const ok = await copyText(familyCode);
    setNotice(
      ok ? "가족코드를 복사했습니다." : "복사하지 못했습니다. 코드를 길게 눌러 복사해주세요."
    );
  }

  async function handleShare() {
    // Web Share API는 모바일 브라우저 대부분이 지원한다. 없으면(주로 PC)
    // 링크까지 포함한 문구를 클립보드에 넣어 같은 목적을 달성한다.
    if (navigator.share) {
      try {
        await navigator.share({
          title: "해피간병 가족간병인 참여",
          text: shareText(),
        });
        return;
      } catch {
        // 사용자가 공유를 취소한 경우도 여기로 온다 — 조용히 넘어간다.
        return;
      }
    }

    const ok = await copyText(shareText());
    setNotice(
      ok
        ? "참여 안내 문구를 복사했습니다. 메신저에 붙여넣어 주세요."
        : "공유하지 못했습니다. 코드를 길게 눌러 복사해주세요."
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span>
          가족코드: <span className="font-bold tracking-wide">{familyCode}</span>
        </span>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="가족코드 복사"
          className="inline-flex items-center gap-1 border border-gray-400 text-gray-700 rounded px-2 py-1 text-xs min-h-[32px]"
        >
          {/* 복사 아이콘(문서 두 장) */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          복사
        </button>

        <button
          type="button"
          onClick={handleShare}
          aria-label="가족코드 공유"
          className="inline-flex items-center gap-1 border border-blue-600 text-blue-700 rounded px-2 py-1 text-xs min-h-[32px]"
        >
          {/* 공유 아이콘(점 세 개 연결) */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
          </svg>
          공유
        </button>
      </div>

      {/* aria-live: 복사 결과가 스크린리더에도 읽히게 한다. 평소에는
          "무엇을 해야 하는지"를 보여준다 — 이 화면의 역할은 가족을 직접
          추가하는 것이 아니라 코드를 전달하는 것이다. */}
      <p className="text-xs text-gray-700 mt-1 leading-snug" aria-live="polite">
        {notice ||
          "가족간병인을 추가하려면 이 가족코드를 전달해 주세요. 추가되는 가족은 본인 휴대폰으로 병원 QR에 접속한 뒤 '가족간병인 추가'를 진행합니다."}
      </p>
    </div>
  );
}
