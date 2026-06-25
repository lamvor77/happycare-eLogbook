"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function PhotoList({
  photos,
}: {
  photos: { photo_id: string; file_url: string }[];
}) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    async function loadUrls() {
      const result = await Promise.all(
        photos.map(async (photo) => {
          const { data } = await supabase.storage
            .from("care-log-photos")
            .createSignedUrl(photo.file_url, 60 * 10);

          return data?.signedUrl || "";
        })
      );

      setUrls(result.filter(Boolean));
    }

    loadUrls();
  }, [photos]);

  return (
    <div className="mt-3">
      <p className="font-bold mb-2">첨부사진</p>

      <div className="grid grid-cols-2 gap-2">
        {urls.map((url) => (
          <img
            key={url}
            src={url}
            alt="간병일지 첨부사진"
            className="rounded border"
          />
        ))}
      </div>
    </div>
  );
}