"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("trinetra_access_token");
    const user = localStorage.getItem("trinetra_user_email");
    const guest = localStorage.getItem("trinetra_guest_mode");

    if (!token && !guest) {
      router.push("/login");
      return;
    }

    setEmail(user);
    setIsGuest(!!guest);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("trinetra_access_token");
    localStorage.removeItem("trinetra_user_email");
    localStorage.removeItem("trinetra_guest_mode");
    router.push("/login");
  };

  if (!email && !isGuest) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-on-surface">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/10">
            <span className="text-xs font-bold text-primary">TR</span>
          </div>
          <div>
            <h1 className="font-bold text-on-surface">Trinetra Dashboard</h1>
            <p className="text-sm text-on-surface-variant">{isGuest ? "Guest Session" : email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-full border border-outline-variant px-4 py-2 text-sm transition-colors hover:bg-error/10 hover:text-error"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <span className="text-4xl">🎉</span>
          </div>
          <h2 className="mb-2 text-2xl font-bold">Welcome to Trinetra!</h2>
          <p className="mb-6 text-on-surface-variant">
            {isGuest
              ? "You are browsing as a guest. Some features may be limited."
              : "You have successfully logged in with OTP verification."}
          </p>
          <div className="rounded-lg border border-outline-variant bg-surface-container p-4 text-left">
            <h3 className="mb-2 font-semibold">Session Info</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Email:</span>
                <span className="font-mono">{email || "guest@local"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Mode:</span>
                <span className="font-mono">{isGuest ? "Guest" : "Authenticated"}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
