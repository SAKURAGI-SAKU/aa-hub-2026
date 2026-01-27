import Express from "npm:express@4.18.2";
const app = Express();
const kv = await Deno.openKv();

app.use(Express.json());
app.use(Express.static("public"));

// --- BANチェック用ヘルパー (修正版) ---
async function isBanned(req) {
    // DenoのRequestオブジェクトからIPを確実に取得する書き方に修正
    const ip = req.headers["x-forwarded-for"] || "unknown";
    const banEntry = await kv.get(["banned_ips", ip]);
    return banEntry.value !== null;
}

// --- ユーザー認証 ---
app.post("/api/register", async (req, res) => {
    // BANチェック
    const ip = req.headers["x-forwarded-for"] || "unknown";
    const banEntry = await kv.get(["banned_ips", ip]);
    if (banEntry.value) return res.status(403).json({ error: "アクセス制限されています" });

    const { userId, password, displayName } = req.body;
    if(!userId || !password) return res.status(400).json({ error: "IDとPWは必須です" });
    
    const existing = await kv.get(["users", userId]);
    if (existing.value) return res.status(400).json({ error: "既に存在するIDです" });
    
    // 一人目をAdminにする
    let isFirst = true;
    const iter = kv.list({ prefix: ["users"] }, { limit: 1 });
    for await (const _ of iter) { isFirst = false; }
    
    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst, ip: ip, blockList: [] };
    await kv.set(["users", userId], user);
    res.json({ success: true, user });
});

app.post("/api/login", async (req, res) => {
    const ip = req.headers["x-forwarded-for"] || "unknown";
    const banEntry = await kv.get(["banned_ips", ip]);
    if (banEntry.value) return res.status(403).json({ error: "制限中です" });

    const { userId, password } = req.body;
    const user = await kv.get(["users", userId]);
    if (user.value && user.value.password === password) {
        res.json({ success: true, user: user.value });
    } else {
        res.status(401).json({ error: "IDまたはPWが違います" });
    }
});

// --- 管理者用：BAN実行 ---
app.post("/api/admin/ban", async (req, res) => {
    const { adminId, targetUserId } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (!admin.value || !admin.value.isAdmin) return res.status(403).send();

    const targetUser = await kv.get(["users", targetUserId]);
    if (targetUser.value) {
        const ip = targetUser.value.ip;
        if (ip && ip !== "unknown") {
            await kv.set(["banned_ips", ip], { bannedAt: new Date() });
        }
        await kv.delete(["users", targetUserId]);
        res.json({ success: true });
    } else {
        res.status(404).send();
    }
});

// --- 掲示板API ---
app.get("/api/posts", async (req, res) => {
    const { q, viewerId } = req.query;
    let blockerList = [];
    if (viewerId) {
        const viewer = await kv.get(["users", viewerId]);
        blockerList = viewer.value?.blockList || [];
    }

    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) {
        const p = entry.value;
        if (blockerList.includes(p.userId)) continue;
        if (q) {
            const s = (p.title + p.content + (p.tags || []).join('')).toLowerCase();
            if (!s.includes(q.toLowerCase())) continue;
        }
        posts.push(p);
    }
    res.json(posts);
});

app.post("/api/posts", async (req, res) => {
    const { title, content, author, userId, tags } = req.body;
    const id = Date.now().toString();
    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
    const newPost = { id, title, content, author, userId, tags: tagList, likes: 0, likedBy: [], createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    res.json({ success: true });
});

app.post("/api/posts/:id/like", async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const postKey = ["posts", id];
    const post = await kv.get(postKey);
    if (post.value) {
        const updated = post.value;
        if (!updated.likedBy.includes(userId)) {
            updated.likes = (updated.likes || 0) + 1;
            updated.likedBy.push(userId);
            await kv.set(postKey, updated);
        }
        res.json({ success: true, likes: updated.likes });
    } else { res.status(404).send(); }
});

app.get("/api/users/:userId/posts", async (req, res) => {
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) {
        if (entry.value.userId === req.params.userId) posts.push(entry.value);
    }
    res.json(posts);
});

app.post("/api/report", async (req, res) => {
    const { postId, userId, reason, postAuthorId } = req.body;
    const id = Date.now().toString();
    await kv.set(["reports", id], { id, postId, reporterId: userId, targetUserId: postAuthorId, reason, createdAt: new Date() });
    res.json({ success: true });
});

app.get("/api/notifications/:userId", async (req, res) => {
    const notes = [];
    const iter = kv.list({ prefix: ["notifications", req.params.userId] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) { notes.push(entry.value); }
    res.json(notes);
});

app.post("/api/admin/notify", async (req, res) => {
    const { adminId, targetUserId, message } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (!admin.value || !admin.value.isAdmin) return res.status(403).send();
    const id = Date.now().toString();
    await kv.set(["notifications", targetUserId, id], { id, message, createdAt: new Date() });
    res.json({ success: true });
});

app.get("/api/admin/reports", async (req, res) => {
    const reports = [];
    const iter = kv.list({ prefix: ["reports"] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) { reports.push(entry.value); }
    res.json(reports);
});

app.post("/api/admin/delete", async (req, res) => {
    const { postId, adminId } = req.body;
    const user = await kv.get(["users", adminId]);
    if (user.value?.isAdmin) await kv.delete(["posts", postId]);
    res.json({ success: true });
});

app.post("/api/user/block", async (req, res) => {
    const { userId, targetId } = req.body;
    const u = await kv.get(["users", userId]);
    if (u.value) {
        const user = u.value;
        if (!user.blockList) user.blockList = [];
        if (!user.blockList.includes(targetId)) user.blockList.push(targetId);
        await kv.set(["users", userId], user);
        res.json({ success: true });
    }
});

app.listen(8000);
