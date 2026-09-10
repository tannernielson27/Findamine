"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { canViewField } from "@/lib/utils/privacy";

interface ChatMessage {
  id: string;
  message: string;
  created_at: string;
  user_id: string;
  users: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    profile_visibility?: Record<string, string>;
  } | null;
}

interface TeamChatProps {
  teamId: string;
  currentUserId: string;
}

export default function TeamChat({ teamId, currentUserId }: TeamChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load initial messages
  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/v1/teams/${teamId}/chat`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
      setLoading(false);
    }
    load();
  }, [teamId]);

  // Real-time subscription
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`team-chat-${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        async (payload) => {
          // Fetch the full message with user join (visibility enforced at render)
          const { data } = await supabase
            .from("team_messages")
            .select("*, users(id, display_name, avatar_url, profile_visibility)")
            .eq("id", payload.new.id)
            .single();
          if (data) {
            setMessages((prev) => {
              // Avoid duplicates (in case we also added it optimistically)
              if (prev.some((m) => m.id === data.id)) return prev;
              return [...prev, data];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);

    const res = await fetch(`/api/v1/teams/${teamId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.trim() }),
    });

    if (res.ok) {
      const data = await res.json();
      // Add optimistically (real-time might also add it)
      setMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      setInput("");
    }
    setSending(false);
  };

  return (
    <div className="flex flex-col h-[400px] rounded-lg border border-gray-200 bg-white">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded w-3/4" />)}
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No messages yet. Start the conversation!</p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user_id === currentUserId;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-2 ${
                  isMe ? "bg-sky-100 text-sky-900" : "bg-gray-100 text-gray-900"
                }`}>
                  {!isMe && (
                    <p className="text-xs font-medium text-gray-500 mb-0.5">
                      {/* Chat viewers are teammates — enforce the sender's display_name
                          visibility (API-loaded messages arrive pre-filtered; this also
                          covers realtime rows fetched directly from the client). */}
                      {msg.users?.id &&
                      msg.users.display_name &&
                      canViewField(msg.users.profile_visibility, "team", "display_name") ? (
                        <Link href={`/profile/${msg.users.id}`} className="hover:underline">
                          {msg.users.display_name}
                        </Link>
                      ) : (
                        "Explorer"
                      )}
                    </p>
                  )}
                  <p className="text-sm">{msg.message}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 280))}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          aria-label="Chat message"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
      <p className="text-[10px] text-gray-500 text-right px-3 pb-1">{input.length}/280</p>
    </div>
  );
}
