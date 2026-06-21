import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { scanComment, type Severity } from "@/lib/moderation";
import { fetchAdminData, adminSetBan } from "@/lib/admin.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CyberGuard — AI Moderated Feed" },
      { name: "description", content: "Real-time moderated community feed with admin moderation log." },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { property: "og:title", content: "CyberGuard" },
      { property: "og:description", content: "Real-time moderated community feed." },
    ],
  }),
  component: App,
});

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
type Post = {
  id: string;
  user_id: string;
  username: string;
  content: string;
  image_url: string | null;
  created_at: string;
};
type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  username: string;
  content: string;
  hidden: boolean;
  category: string | null;
  severity: Severity | null;
  created_at: string;
};
type LogEntry = {
  id: string;
  username: string;
  content: string;
  action: string;
  category: string | null;
  severity: string | null;
  created_at: string;
};
type StrikeRow = { user_id: string; username: string; count: number; banned: boolean };

// ──────────────────────────────────────────────────────────────
// Utils
// ──────────────────────────────────────────────────────────────
const COLORS = ["#dbeafe|#1e40af", "#d1fae5|#065f46", "#ede9fe|#5b21b6", "#fef3c7|#92400e", "#fee2e2|#7f1d1d", "#dcfce7|#14532d"];
function avatarColors(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const [bg, fg] = COLORS[h % COLORS.length].split("|");
  return { bg, fg };
}
function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}
function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function usernameToEmail(u: string) {
  return `${u.toLowerCase().replace(/[^a-z0-9_]/g, "_")}@cyberguard.app`;
}
async function fileToDataUrl(file: File, maxSize = 1200, quality = 0.8): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

// ──────────────────────────────────────────────────────────────
// App
// ──────────────────────────────────────────────────────────────
function App() {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        setUserId(data.session.user.id);
        const { data: p } = await supabase.from("profiles").select("username").eq("id", data.session.user.id).maybeSingle();
        setUsername(p?.username ?? data.session.user.email?.split("@")[0] ?? "user");
      }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (session) {
        setUserId(session.user.id);
        const { data: p } = await supabase.from("profiles").select("username").eq("id", session.user.id).maybeSingle();
        setUsername(p?.username ?? session.user.email?.split("@")[0] ?? "user");
      } else {
        setUserId(null);
        setUsername(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Loading…</div>;
  if (!userId || !username) return <AuthScreen />;
  return <Main userId={userId} username={username} />;
}

// ──────────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [u, setU] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const email = usernameToEmail(u.trim());
    try {
      if (mode === "signup") {
        if (u.trim().length < 3) throw new Error("Username must be at least 3 characters");
        if (pw.length < 6) throw new Error("Password must be at least 6 characters");
        const { error } = await supabase.auth.signUp({
          email,
          password: pw,
          options: { data: { username: u.trim() } },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (e: any) {
      setErr(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <form onSubmit={submit} style={card({ width: "100%", maxWidth: 360, padding: 22 })}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>CyberGuard</div>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {mode === "login" ? "Welcome back" : "Create account"}
        </h2>
        <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 16 }}>
          {mode === "login" ? "Sign in with your username." : "Pick a username to join the feed."}
        </p>
        <label style={lbl}>Username</label>
        <input
          value={u}
          onChange={(e) => setU(e.target.value)}
          placeholder="e.g. sneha_r"
          autoComplete="username"
          style={inp}
          required
        />
        <label style={{ ...lbl, marginTop: 10 }}>Password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="At least 6 characters"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          style={inp}
          required
        />
        {err && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger-text)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", padding: "8px 10px", borderRadius: 8 }}>
            {err}
          </div>
        )}
        <button disabled={busy} type="submit" style={{ ...btnPrimary, marginTop: 14, width: "100%" }}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); }}
          style={{ marginTop: 10, width: "100%", background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer" }}
        >
          {mode === "login" ? "New here? Create an account" : "Already have one? Sign in"}
        </button>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main app shell (feed + hidden admin)
// ──────────────────────────────────────────────────────────────
function Main({ userId, username }: { userId: string; username: string }) {
  const [tab, setTab] = useState<"feed" | "profile" | "admin">("feed");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminPw, setAdminPw] = useState<string | null>(null);
  const [adminPrompt, setAdminPrompt] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <div style={{
        background: "var(--card)", borderBottom: "1px solid var(--border)",
        padding: "0 16px", display: "flex", alignItems: "center", position: "sticky",
        top: 0, zIndex: 100,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", padding: "14px 0", flex: 1, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
          CyberGuard
        </div>
        <button onClick={() => setTab("feed")} style={tabBtn(tab === "feed")}>Feed</button>
        <button onClick={() => setTab("profile")} style={tabBtn(tab === "profile")}>Profile</button>
        <button
          onClick={() => { if (adminAuthed) setTab("admin"); else setAdminPrompt(true); }}
          style={tabBtn(tab === "admin")}
        >
          Admin
        </button>
        <button onClick={signOut} title="Sign out" style={{ marginLeft: 8, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--sub)", padding: "10px 6px" }}>⎋</button>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "18px 14px 60px" }}>
        {tab === "feed" && <Feed userId={userId} username={username} />}
        {tab === "profile" && <Profile userId={userId} username={username} />}
        {tab === "admin" && adminAuthed && adminPw && <Admin password={adminPw} />}
      </div>

      {adminPrompt && (
        <AdminLogin
          onClose={() => setAdminPrompt(false)}
          onSuccess={(pw) => {
            setAdminPw(pw);
            setAdminAuthed(true);
            setAdminPrompt(false);
            setTab("admin");
          }}
        />
      )}
    </div>
  );
}

function Profile({ userId, username }: { userId: string; username: string }) {
  const [strike, setStrike] = useState<StrikeRow | null>(null);
  const [postCount, setPostCount] = useState<number>(0);
  const [commentCount, setCommentCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: s }, { count: pc }, { count: cc }] = await Promise.all([
      supabase.from("strikes").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("comments").select("*", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    setStrike((s as StrikeRow) ?? { user_id: userId, username, count: 0, banned: false });
    setPostCount(pc ?? 0);
    setCommentCount(cc ?? 0);
    setLoading(false);
  }, [userId, username]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 28, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>Loading…</div>;

  const count = strike?.count ?? 0;
  const banned = !!strike?.banned;

  return (
    <>
      <div style={{ ...card(), padding: 20, marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={username} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>@{username}</div>
          <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>
            {banned ? <span style={pill("#fee2e2", "#7f1d1d")}>Banned</span> : <span style={pill("#f0fdf4", "#166534")}>Active</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        <Stat label="Posts" value={postCount} />
        <Stat label="Comments" value={commentCount} />
        <Stat label="Strikes" value={count} color={count >= 2 ? "#ef4444" : count > 0 ? "#f59e0b" : undefined} />
      </div>

      <div style={{ ...card(), padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Strike progress</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, height: 10, borderRadius: 99, background: i < count ? "#ef4444" : "#e5e7eb" }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--sub)" }}>
          {banned
            ? "You have been banned for repeated violations."
            : count === 0
              ? "Clean record — keep it up!"
              : `${count}/3 strikes used. ${3 - count} more will result in an automatic ban.`}
        </div>
      </div>

      {banned && (
        <div style={banner("danger")}>🚫 Your account is banned. You can read the feed but cannot post or comment.</div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Feed
// ──────────────────────────────────────────────────────────────
function Feed({ userId, username }: { userId: string; username: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, Comment[]>>({});
  const [strike, setStrike] = useState<StrikeRow | null>(null);

  const loadStrike = useCallback(async () => {
    const { data } = await supabase.from("strikes").select("*").eq("user_id", userId).maybeSingle();
    setStrike((data as StrikeRow) ?? { user_id: userId, username, count: 0, banned: false });
  }, [userId, username]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: ps } = await supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(100);
      if (!mounted) return;
      setPosts((ps as Post[]) ?? []);
      const ids = (ps ?? []).map((p) => p.id);
      if (ids.length) {
        const { data: cs } = await supabase.from("comments").select("*").in("post_id", ids).order("created_at", { ascending: true });
        const grouped: Record<string, Comment[]> = {};
        for (const c of (cs as Comment[]) ?? []) (grouped[c.post_id] ||= []).push(c);
        if (mounted) setCommentsByPost(grouped);
      }
    })();
    loadStrike();

    const ch = supabase
      .channel("feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (payload) => {
        setPosts((prev) => {
          const np = payload.new as Post;
          if (prev.some((p) => p.id === np.id)) return prev;
          return [np, ...prev];
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, (payload) => {
        const old = payload.old as { id: string };
        setPosts((prev) => prev.filter((p) => p.id !== old.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, (payload) => {
        const nc = payload.new as Comment;
        setCommentsByPost((prev) => {
          const arr = prev[nc.post_id] ?? [];
          if (arr.some((c) => c.id === nc.id)) return prev;
          return { ...prev, [nc.post_id]: [...arr, nc] };
        });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "comments" }, (payload) => {
        const old = payload.old as { id: string; post_id?: string };
        setCommentsByPost((prev) => {
          const next: Record<string, Comment[]> = {};
          for (const k of Object.keys(prev)) next[k] = prev[k].filter((c) => c.id !== old.id);
          return next;
        });
      })
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [loadStrike]);

  return (
    <>
      {strike && strike.banned && (
        <div style={banner("danger")}>
          🚫 You've been banned for repeated violations. You can read but not post or comment.
        </div>
      )}
      {strike && !strike.banned && strike.count > 0 && (
        <div style={banner(strike.count >= 2 ? "warn" : "info")}>
          ⚠️ You have <b>{strike.count}/3</b> strikes. {3 - strike.count} more = auto-ban.
        </div>
      )}

      <Composer userId={userId} username={username} banned={!!strike?.banned} />

      {posts.length === 0 && (
        <div style={{ ...card(), padding: 28, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>
          No posts yet. Be the first to share something!
        </div>
      )}

      {posts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          comments={commentsByPost[p.id] ?? []}
          userId={userId}
          username={username}
          banned={!!strike?.banned}
          onAfterStrike={loadStrike}
        />
      ))}
    </>
  );
}

function Composer({ userId, username, banned }: { userId: string; username: string; banned: boolean }) {
  const [text, setText] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const url = await fileToDataUrl(f);
      setImg(url);
    } catch {
      alert("Could not load image");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function post() {
    if (banned) return;
    if (!text.trim() && !img) return;
    setBusy(true);
    const { error } = await supabase.from("posts").insert({
      user_id: userId,
      username,
      content: text.trim(),
      image_url: img,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setText("");
    setImg(null);
  }

  return (
    <div style={{ ...card(), padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Avatar name={username} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={banned ? "You are banned from posting." : "Share something with the community…"}
            disabled={banned}
            rows={2}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 10px", fontSize: 13, resize: "vertical", outline: "none", background: "#fafafa" }}
          />
          {img && (
            <div style={{ position: "relative", marginTop: 8 }}>
              <img src={img} alt="" style={{ width: "100%", borderRadius: 10, display: "block" }} />
              <button onClick={() => setImg(null)} style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,.6)", color: "#fff", border: "none", borderRadius: 99, width: 26, height: 26, cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <label style={{ fontSize: 12, color: "var(--sub)", cursor: banned ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              📷 <span>Photo</span>
              <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} disabled={banned} style={{ display: "none" }} />
            </label>
            <button onClick={post} disabled={busy || banned || (!text.trim() && !img)} style={btnPrimary}>
              {busy ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post, comments, userId, username, banned, onAfterStrike,
}: {
  post: Post; comments: Comment[]; userId: string; username: string; banned: boolean; onAfterStrike: () => void;
}) {
  const isOwner = post.user_id === userId;
  async function deletePost() {
    if (!confirm("Delete this post?")) return;
    const { error } = await supabase.from("posts").delete().eq("id", post.id);
    if (error) alert(error.message);
  }
  return (
    <div style={{ ...card(), marginBottom: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 14px 8px" }}>
        <Avatar name={post.username} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{post.username}</div>
          <div style={{ fontSize: 11, color: "var(--sub)" }}>{timeAgo(post.created_at)}</div>
        </div>
        {isOwner && (
          <button onClick={deletePost} title="Delete post" style={iconBtn}>🗑️</button>
        )}
      </div>
      {post.content && <div style={{ padding: "0 14px 12px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{post.content}</div>}
      {post.image_url && <img src={post.image_url} alt="" style={{ width: "100%", display: "block" }} />}

      <div style={{ borderTop: "1px solid #f0f0f0", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {comments.length === 0 && <div style={{ fontSize: 11, color: "var(--sub)" }}>No comments yet.</div>}
        {comments.map((c) => <CommentRow key={c.id} c={c} currentUserId={userId} />)}
      </div>
      <CommentInput postId={post.id} userId={userId} username={username} banned={banned} onAfterStrike={onAfterStrike} />
    </div>
  );
}

function CommentRow({ c, currentUserId }: { c: Comment; currentUserId: string }) {
  const isOwner = c.user_id === currentUserId;
  async function del() {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabase.from("comments").delete().eq("id", c.id);
    if (error) alert(error.message);
  }
  if (c.hidden) {
    return (
      <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-border)", borderRadius: 10, padding: "9px 11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14 }}>🚫</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--danger-text)", flex: 1 }}>
            Comment hidden from @{c.username} — {c.category}
          </span>
          <span style={pill(c.severity === "severe" ? "#fee2e2" : c.severity === "moderate" ? "#fed7aa" : "#fef9c3", c.severity === "severe" ? "#7f1d1d" : c.severity === "moderate" ? "#7c2d12" : "#713f12")}>
            {c.severity}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <Avatar name={c.username} size={26} fontSize={10} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#333" }}>{c.username}</div>
        <div style={{ fontSize: 12, background: "#f6f7f9", borderRadius: 8, padding: "7px 9px", lineHeight: 1.5, wordBreak: "break-word", marginTop: 2 }}>
          {c.content}
        </div>
      </div>
      <span style={pill("#f0fdf4", "#166534")}>Safe</span>
      {isOwner && <button onClick={del} title="Delete comment" style={iconBtnSm}>🗑️</button>}
    </div>
  );
}

function CommentInput({
  postId, userId, username, banned, onAfterStrike,
}: { postId: string; userId: string; username: string; banned: boolean; onAfterStrike: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "D" | "S"; msg: string } | null>(null);

  async function send() {
    const t = text.trim();
    if (!t || busy || banned) return;
    setBusy(true);
    setNotice(null);
    const scan = scanComment(t);

    const { error } = await supabase.from("comments").insert({
      post_id: postId,
      user_id: userId,
      username,
      content: t,
      hidden: scan.hidden,
      category: scan.category,
      severity: scan.severity,
    });

    if (error) {
      alert(error.message);
      setBusy(false);
      return;
    }

    // Log
    await supabase.from("moderation_log").insert({
      user_id: userId,
      username,
      content: t,
      action: scan.hidden ? "hidden" : "safe",
      category: scan.category,
      severity: scan.severity,
    });

    if (scan.hidden) {
      // Increment strike
      const { data: row } = await supabase.from("strikes").select("*").eq("user_id", userId).maybeSingle();
      const newCount = (row?.count ?? 0) + 1;
      const banned = newCount >= 3;
      if (row) {
        await supabase.from("strikes").update({ count: newCount, banned, username, updated_at: new Date().toISOString() }).eq("user_id", userId);
      } else {
        await supabase.from("strikes").insert({ user_id: userId, username, count: newCount, banned });
      }
      onAfterStrike();
      setNotice({ type: "D", msg: `Comment hidden — ${scan.category}. Strike ${newCount}/3${banned ? " — you are now banned." : "."}` });
    } else {
      setNotice({ type: "S", msg: "Comment posted." });
      setTimeout(() => setNotice(null), 2500);
    }
    setText("");
    setBusy(false);
  }

  return (
    <div style={{ padding: "0 14px 12px" }}>
      {notice && (
        <div style={banner(notice.type === "D" ? "danger" : "safe")}>{notice.msg}</div>
      )}
      <div style={{ display: "flex", gap: 7, alignItems: "center", padding: "8px 0 4px" }}>
        <Avatar name={username} size={26} fontSize={10} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          placeholder={banned ? "You are banned." : "Write a comment…"}
          disabled={banned}
          style={{ flex: 1, fontSize: 12, border: "1px solid var(--border)", borderRadius: 99, padding: "8px 12px", outline: "none", background: "#f8f8f8" }}
        />
        <button onClick={send} disabled={busy || banned || !text.trim()} style={btnPrimary}>Post</button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Admin
// ──────────────────────────────────────────────────────────────
function AdminLogin({ onClose, onSuccess }: { onClose: () => void; onSuccess: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verify = useServerFn(fetchAdminData);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await verify({ data: { password: pw } });
      onSuccess(pw);
    } catch (e: any) {
      setErr("Invalid admin password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlay}>
      <form onSubmit={submit} style={{ ...card(), width: "100%", maxWidth: 360, padding: 22 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Admin access</h3>
        <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12 }}>Enter the admin password to view the moderation log and strikes.</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Admin password"
          style={inp}
        />
        {err && <div style={{ marginTop: 10, fontSize: 12, color: "var(--danger-text)" }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy || !pw} style={btnPrimary}>{busy ? "Checking…" : "Unlock"}</button>
        </div>
      </form>
    </div>
  );
}

function Admin({ password }: { password: string }) {
  const fetchFn = useServerFn(fetchAdminData);
  const banFn = useServerFn(adminSetBan);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [strikes, setStrikes] = useState<StrikeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "hidden" | "safe">("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchFn({ data: { password } });
      setLog(r.log);
      setStrikes(r.strikes);
    } finally {
      setLoading(false);
    }
  }, [fetchFn, password]);

  useEffect(() => { refresh(); }, [refresh]);

  // realtime refresh on new log/strike inserts (poll every 4s as simple sync)
  useEffect(() => {
    const ch = supabase
      .channel("admin-sync")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  async function toggleBan(s: StrikeRow) {
    await banFn({ data: { password, userId: s.user_id, banned: !s.banned } });
    refresh();
  }

  const filtered = useMemo(() => {
    if (filter === "all") return log;
    return log.filter((l) => (filter === "hidden" ? l.action === "hidden" : l.action === "safe"));
  }, [log, filter]);

  const counts = useMemo(() => ({
    total: log.length,
    hidden: log.filter((l) => l.action === "hidden").length,
    safe: log.filter((l) => l.action === "safe").length,
    banned: strikes.filter((s) => s.banned).length,
  }), [log, strikes]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <Stat label="Checked" value={counts.total} />
        <Stat label="Hidden" value={counts.hidden} color="#ef4444" />
        <Stat label="Safe" value={counts.safe} color="#10b981" />
        <Stat label="Banned" value={counts.banned} color="#7f1d1d" />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Moderation Log</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "hidden", "safe"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} style={filterBtn(filter === f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ ...card(), marginBottom: 18 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>No events.</div>
        ) : filtered.map((l) => (
          <div key={l.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, wordBreak: "break-word" }}>{l.content}</div>
              <div style={{ color: "var(--sub)", fontSize: 11, marginTop: 2 }}>
                @{l.username} · {timeAgo(l.created_at)} {l.category ? `· ${l.category}` : ""}
              </div>
            </div>
            {l.action === "hidden"
              ? <span style={pill("#fee2e2", "#7f1d1d")}>Hidden</span>
              : <span style={pill("#f0fdf4", "#166534")}>Safe</span>}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>User Strikes</h2>
      {strikes.length === 0 && <div style={{ ...card(), padding: 20, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>No strikes yet.</div>}
      {strikes.map((s) => (
        <div key={s.user_id} style={{ ...card(), padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={s.username} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.username} {s.banned && <span style={{ ...pill("#fee2e2", "#7f1d1d"), marginLeft: 6 }}>Banned</span>}</div>
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{s.count} / 3 strikes</div>
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: i < s.count ? "#ef4444" : "#e5e7eb" }} />
            ))}
          </div>
          <button onClick={() => toggleBan(s)} style={s.banned ? btnSafeSmall : btnDangerSmall}>
            {s.banned ? "Unban" : "Ban"}
          </button>
        </div>
      ))}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ ...card(), padding: "10px 12px" }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: color ?? "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function Avatar({ name, size = 32, fontSize }: { name: string; size?: number; fontSize?: number }) {
  const { bg, fg } = avatarColors(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: bg, color: fg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: fontSize ?? Math.round(size * 0.36), fontWeight: 700, flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

// ──────────────────────────────────────────────────────────────
// Style helpers
// ──────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--sub)", display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 };
const inp: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, outline: "none", background: "#fafafa" };
const btnPrimary: React.CSSProperties = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 99, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--border)", color: "var(--sub)", borderRadius: 99, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const btnDangerSmall: React.CSSProperties = { background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-text)", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" };
const btnSafeSmall: React.CSSProperties = { background: "var(--safe-bg)", border: "1px solid var(--safe-border)", color: "var(--safe-text)", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 200 };

function card(extra: React.CSSProperties = {}): React.CSSProperties {
  return { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, ...extra };
}
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "14px 14px", fontSize: 13, fontWeight: 500,
    color: active ? "var(--accent)" : "var(--sub)",
    background: "none", border: "none", borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    cursor: "pointer",
  };
}
function filterBtn(on: boolean): React.CSSProperties {
  return {
    fontSize: 11, padding: "5px 12px", borderRadius: 99,
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
    background: on ? "var(--accent)" : "var(--card)",
    color: on ? "#fff" : "var(--sub)", cursor: "pointer", fontWeight: 500,
  };
}
function banner(kind: "danger" | "warn" | "info" | "safe"): React.CSSProperties {
  const map = {
    danger: { bg: "var(--danger-bg)", b: "var(--danger-border)", c: "var(--danger-text)" },
    warn:   { bg: "var(--warn-bg)",   b: "var(--warn-border)",   c: "var(--warn-text)" },
    info:   { bg: "#eff6ff",          b: "#93c5fd",              c: "#1e3a8a" },
    safe:   { bg: "var(--safe-bg)",   b: "var(--safe-border)",   c: "var(--safe-text)" },
  }[kind];
  return { background: map.bg, border: `1px solid ${map.b}`, color: map.c, padding: "9px 12px", borderRadius: 10, fontSize: 12, marginBottom: 10 };
}
function pill(bg: string, color: string): React.CSSProperties {
  return { fontSize: 10, padding: "2px 8px", borderRadius: 99, background: bg, color, fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" };
}
