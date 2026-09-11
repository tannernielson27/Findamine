"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Settings, RefreshCw, Shield, BookOpen, Users } from "lucide-react";

export default function SettingsPage() {
  const [user, setUser] = useState<{ display_name: string; email: string; role: string } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/auth/me").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setDisplayName(data.user.display_name || "");
      }
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    const res = await fetch("/api/v1/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    });

    if (res.ok) {
      setMessage("Saved!");
    } else {
      setMessage("Failed to save.");
    }
    setSaving(false);
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-32 bg-gray-100 rounded-xl mx-auto" />
          <div className="h-40 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-brand" />
        Settings
      </h1>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5">{user.email}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-2.5 capitalize">{user.role}</p>
          </div>

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
              Explorer Name
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
            />
          </div>

          {message && (
            <p className={`text-sm font-medium ${message === "Saved!" ? "text-green-600" : "text-red-600"}`}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition-all"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="font-[family-name:var(--font-display)] font-semibold text-gray-900">More</h2>

        <button
          onClick={() => {
            localStorage.removeItem("onboarding_complete");
            window.location.href = "/dashboard";
          }}
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          Run welcome tutorial again
        </button>

        <Link
          href="/settings/privacy"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <Shield className="w-4 h-4" />
          Privacy settings
        </Link>

        <Link
          href="/dashboard/join-class"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <Users className="w-4 h-4" />
          Join a class with a code
        </Link>

        <Link
          href="/debrief"
          className="flex items-center gap-2 text-sm text-brand hover:underline font-medium"
        >
          <BookOpen className="w-4 h-4" />
          About this research study
        </Link>
      </div>
    </main>
  );
}
