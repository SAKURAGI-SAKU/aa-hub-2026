import { Hono } from "https://deno.land";
import { serveStatic } from "https://deno.land";

const app = new Hono();
const kv = await Deno.openKv();

// 静的ファイルの提供 (publicフォルダ内)
app.use("/*", serveStatic({ root: "./public" }));

// --- 認証系 ---
app.post("/api/register", async (c) => {
    const { userId, password, displayName } = await c.req.json();
    if (!userId || !password) return c.json({ error: "入力不足" }, 400);
    const existing = await kv.get(["users", userId]);
    if (existing.value) return c.json({ error: "ID重複" }, 400);
    
    let isFirst = true;
    for await (const _ of kv.list({ prefix: ["users"] }, { limit: 1 })) { isFirst = false; }
    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst, blockList: [] };
    await kv.set(["users", userId], user);
    return c.json({ success: true, user });
});

app.post("/api/login", async (c) => {
    const { userId, password } = await c.req.json();
    const user = await kv.get(["users", userId]);
    if (user.value && user.value.password === password) return c.json({ success: true, user: user.value });
    return c.json({ error: "認証失敗" }, 401);
});

// --- 掲示板API ---
app.get("/api/posts", async (c) => {
    const q = c.req.query("q");
    const viewerId = c.req.query("viewerId");
    let blockerList = [];
    if (viewerId) {
        const viewer = await kv.get(["users", viewerId]);
        blockerList = viewer.value?.blockList || [];
    }
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
    for await (const entry of iter) {
        const p = entry.value;
        if (blockerList.includes(p.userId)) continue;
        if (q) {
            const s = (p.title + p.content + (p.tags || []).join('')).toLowerCase();
            if (!s.includes(q.toLowerCase())) continue;
        }
        posts.push(p);
    }
    return c.json(posts);
});

app.post("/api/posts", async (c) => {
    const { title, content, author, userId, tags } = await c.req.json();
    const id = Date.now().toString();
    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
    const newPost = { id, title, content, author, userId, tags: tagList, likes: 0, likedBy: [], createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    return c.json({ success: true });
});

app.post("/api/posts/:id/like", async (c) => {
    const id = c.req.param("id");
    const { userId } = await c.req.json();
    const postKey = ["posts", id];
    const post = await kv.get(postKey);
    if (post.value) {
        const updated = post.value;
        if (!updated.likedBy.includes(userId)) {
            updated.likes = (updated.likes || 0) + 1;
            updated.likedBy.push(userId);
            await kv.set(postKey, updated);
        }
        return c.json({ success: true, likes: updated.likes });
    }
    return c.notFound();
});

// --- プロフィール・通報 ---
app.get("/api/users/:uid/posts", async (c) => {
    const uid = c.req.param("uid");
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
    for await (const entry of iter) {
        if (entry.value.userId === uid) posts.push(entry.value);
    }
    return c.json(posts);
});

app.post("/api/report", async (c) => {
    const body = await c.req.json();
    const id = Date.now().toString();
    await kv.set(["reports", id], { ...body, id, createdAt: new Date() });
    return c.json({ success: true });
});

// --- 通知・管理 ---
app.get("/api/emergency", async (c) => {
    const entry = await kv.get(["emergency_message"]);
    return c.json(entry.value || null);
});

app.get("/api/notifications/:userId", async (c) => {
    const userId = c.req.param("userId");
    const notes = [];
    const iter = kv.list({ prefix: ["notifications", userId] }, { reverse: true });
    for await (const entry of iter) {
        if (!entry.value.read) notes.push(entry.value);
    }
    return c.json(notes);
});

app.post("/api/notifications/read", async (c) => {
    const { userId } = await c.req.json();
    const iter = kv.list({ prefix: ["notifications", userId] });
    for await (const entry of iter) {
        const note = entry.value;
        note.read = true;
        await kv.set(entry.key, note);
    }
    return c.json({ success: true });
});

app.post("/api/admin/emergency", async (c) => {
    const { adminId, message } = await c.req.json();
    const admin = await kv.get(["users", adminId]);
    if (!admin.value?.isAdmin) return c.json({ error: "Forbidden" }, 403);
    await kv.set(["emergency_message"], { message, createdAt: new Date().getTime().toString() });
    return c.json({ success: true });
});

app.post("/api/admin/notify", async (c) => {
    const { adminId, targetUserId, message, isEmergency } = await c.req.json();
    const admin = await kv.get(["users", adminId]);
    if (!admin.value?.isAdmin) return c.json({ error: "Forbidden" }, 403);
    const id = Date.now().toString();
    await kv.set(["notifications", targetUserId, id], { id, message, createdAt: new Date().getTime().toString(), read: false, isEmergency: !!isEmergency });
    return c.json({ success: true });
});

app.post("/api/admin/delete", async (c) => {
    const { postId, adminId } = await c.req.json();
    const admin = await kv.get(["users", adminId]);
    if (admin.value?.isAdmin) {
        await kv.delete(["posts", postId]);
        return c.json({ success: true });
    }
    return c.json({ error: "Forbidden" }, 403);
});

app.get("/api/admin/reports", async (c) => {
    const reports = [];
    const iter = kv.list({ prefix: ["reports"] }, { reverse: true });
    for await (const entry of iter) { reports.push(entry.value); }
    return c.json(reports);
});

Deno.serve(app.fetch);
