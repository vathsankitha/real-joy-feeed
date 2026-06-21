import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({ password: z.string().min(1).max(200) });

export const fetchAdminData = createServerFn({ method: "POST" })
  .inputValidator((d) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
      throw new Error("Admin password not configured");
    }
    if (data.password !== expected) {
      throw new Error("Invalid admin password");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [logRes, strikesRes] = await Promise.all([
      supabaseAdmin
        .from("moderation_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("strikes")
        .select("*")
        .order("count", { ascending: false }),
    ]);
    if (logRes.error) throw new Error(logRes.error.message);
    if (strikesRes.error) throw new Error(strikesRes.error.message);
    return { log: logRes.data ?? [], strikes: strikesRes.data ?? [] };
  });

export const adminSetBan = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ password: z.string(), userId: z.string().uuid(), banned: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    if (data.password !== process.env.ADMIN_PASSWORD) throw new Error("Invalid admin password");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("strikes")
      .update({ banned: data.banned, updated_at: new Date().toISOString() })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
