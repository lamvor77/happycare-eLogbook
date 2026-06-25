"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="mt-6 bg-blue-600 text-white px-4 py-2 rounded print:hidden"
    >
      PDF로 저장/인쇄
    </button>
  );
}