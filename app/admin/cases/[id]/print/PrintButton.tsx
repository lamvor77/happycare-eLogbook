"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden bg-blue-600 text-white px-4 py-2 rounded"
    >
      인쇄하기
    </button>
  );
}
