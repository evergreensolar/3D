"use client";
// Comments on the design: pinned to a point on the model (numbered) or general; replies;
// the team can resolve. Works for the customer link and the team page.
import { useState } from "react";
import type { CommentDTO } from "@/lib/comments";
import { formatIST } from "@/lib/time";

export function CommentsPanel({ comments, team, locked, picking, pendingPoint, activeId, onStartPin, onCancelPin, onPost, onResolve, onSelect }: {
  comments: CommentDTO[];
  team: boolean;
  locked: boolean;
  picking: boolean;
  pendingPoint: boolean;
  activeId: string | null;
  onStartPin: () => void;
  onCancelPin: () => void;
  onPost: (body: string, opts: { pinned: boolean; parentId?: string }) => Promise<string | null>;
  onResolve?: (id: string, resolved: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});

  async function send(pinned: boolean) {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    const err = await onPost(text, { pinned });
    setBusy(false);
    if (err) setError(err); else setText("");
  }

  const open = comments.filter((c) => !c.resolvedAt).length;
  return (
    <div className="space-y-4">
      {!locked && (
        <div className="space-y-2 rounded-xl bg-violet-50 p-3">
          {pendingPoint ? (
            <p className="text-xs font-semibold text-violet-800">📍 Point selected on the model — write your comment and send.</p>
          ) : picking ? (
            <p className="text-xs text-violet-800">Tap the spot on the 3D model the comment is about… <button className="underline" onClick={onCancelPin}>Cancel</button></p>
          ) : (
            <button className="btn-secondary w-full" onClick={onStartPin}>📍 Comment on a spot of the model</button>
          )}
          <textarea className="input text-sm" rows={3} placeholder={pendingPoint ? "e.g. Please don't put panels here" : "Write a general comment or question…"} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || !text.trim()} onClick={() => send(pendingPoint)}>
            {busy ? "Sending…" : pendingPoint ? "Send pinned comment" : "Send comment"}
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
      <p className="text-xs text-gray-500">{comments.length ? `${comments.length} comment${comments.length === 1 ? "" : "s"} · ${open} open` : "No comments yet."}</p>
      <ul className="space-y-3">
        {[...comments].reverse().map((c) => (
          <li key={c.id} id={`c-${c.id}`} className={`rounded-xl p-3 ring-1 ${activeId === c.id ? "ring-2 ring-violet-500" : "ring-gray-200"} ${c.resolvedAt ? "opacity-70" : ""}`}>
            <div className="flex items-start gap-2">
              {c.anchor ? (
                <button onClick={() => onSelect(c.id)} className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ${c.resolvedAt ? "bg-gray-400" : "bg-violet-600"}`} title="Show on model">{c.n}</button>
              ) : <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 px-1 text-[11px]">💬</span>}
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-500"><b className="text-gray-800">{c.author}</b> · {formatIST(c.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{c.resolvedAt ? " · ✓ resolved" : ""}</div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
                {c.replies.map((r) => (
                  <div key={r.id} className={`mt-2 rounded-lg p-2 text-sm ${r.fromCustomer ? "bg-gray-50" : "bg-brand-50"}`}>
                    <div className="text-xs text-gray-500"><b className="text-gray-800">{r.author}</b> · {formatIST(r.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</div>
                    <p className="whitespace-pre-wrap">{r.body}</p>
                  </div>
                ))}
                {!locked && (
                  <div className="mt-2 flex gap-2">
                    <input className="input min-w-0 flex-1 px-2 py-1 text-xs" placeholder="Reply…" value={reply[c.id] ?? ""} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })}
                      onKeyDown={async (e) => { if (e.key === "Enter" && reply[c.id]?.trim()) { const err = await onPost(reply[c.id], { pinned: false, parentId: c.id }); if (!err) setReply({ ...reply, [c.id]: "" }); } }} />
                    <button className="btn-secondary px-2 py-1 text-xs" disabled={!reply[c.id]?.trim()}
                      onClick={async () => { const err = await onPost(reply[c.id], { pinned: false, parentId: c.id }); if (!err) setReply({ ...reply, [c.id]: "" }); }}>Reply</button>
                  </div>
                )}
                {team && onResolve && (
                  <button className="mt-2 text-xs font-semibold text-brand-700" onClick={() => onResolve(c.id, !c.resolvedAt)}>{c.resolvedAt ? "Reopen" : "✓ Mark resolved"}</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
