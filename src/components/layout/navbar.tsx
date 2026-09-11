"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";
import NotificationBell from "./notification-bell";
import SurveyNudge from "./survey-nudge";
import { Compass, Map, PlusCircle, Users, ShieldCheck, Settings, LogOut, Menu, X, Lock } from "lucide-react";

interface NavbarProps {
  user: {
    id: string;
    display_name: string | null;
    role: string;
    avatar_url: string | null;
    /** Assigned friction condition — "low" surfaces Privacy in the main nav. */
    privacy_friction?: "low" | "high" | null;
  } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  const isCreator = user && ["teacher", "hunt_creator", "admin", "researcher"].includes(user.role);
  const isAdmin = user && ["admin", "researcher"].includes(user.role);

  const navLinks = user
    ? [
        { href: "/dashboard", label: "Dashboard", icon: Compass },
        { href: "/browse", label: "Browse", icon: Map },
        ...(isCreator
          ? [
              { href: "/dashboard/hunts/new", label: "Create", icon: PlusCircle },
              { href: "/dashboard/rosters", label: "Rosters", icon: Users },
            ]
          : []),
        ...(isAdmin
          ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }]
          : []),
        // LOW-friction condition: privacy is one prominent click from anywhere.
        // (High-friction participants reach it via Settings → More → Privacy.)
        ...(user.privacy_friction === "low"
          ? [{ href: "/settings/privacy", label: "Privacy", icon: Lock }]
          : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-themed-border shadow-sm">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-12">
        {/* Logo */}
        <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 group">
          <Image
            src="/logo-findamine.png"
            alt="findamine"
            width={120}
            height={28}
            className="max-h-[28px] w-auto group-hover:opacity-80 transition-opacity"
            style={{ objectFit: "contain", height: "28px" }}
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-brand/10 text-brand font-semibold"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <SurveyNudge />
              <NotificationBell />
              <Link
                href="/settings"
                className="hidden sm:flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {user.avatar_url ? (
                  <Image src={user.avatar_url} alt="" width={20} height={20} className="rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-brand">
                      {(user.display_name || "?")[0].toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="max-w-[100px] truncate">{user.display_name || "Profile"}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-colors"
              >
                Sign up
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          {user && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="sm:hidden p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Navigation menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && user && (
        <nav className="sm:hidden border-t border-themed-border bg-white px-3 py-2 space-y-0.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-brand/10 text-brand font-semibold"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {link.label}
              </Link>
            );
          })}
          <hr className="my-1.5 border-gray-100" />
          <Link
            href="/settings"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Settings className="w-4 h-4" />
            {user.display_name || "Profile"}
          </Link>
          <button
            onClick={() => { setMenuOpen(false); handleLogout(); }}
            className="flex items-center gap-2.5 w-full text-left rounded-lg px-3 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </nav>
      )}
    </header>
  );
}
