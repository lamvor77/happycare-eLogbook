"use client";

export default function CopyInviteButton({
  inviteCode,
}: {
  inviteCode: string;
}) {
  async function handleCopy() {
    await navigator.clipboard.writeText(inviteCode);
    alert("초대코드가 복사되었습니다.");
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-2 bg-gray-200 px-3 py-1 rounded text-sm"
    >
      복사
    </button>
  );
}