"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ClientCheckRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p className="text-text-muted mt-4">Đang chuyển hướng...</p>
      </div>
    </div>
  );
}
