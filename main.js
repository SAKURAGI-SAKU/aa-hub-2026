import Express from "npm:express@4.18.2";
const app = Express();
const kv = await Deno.openKv();

app.use(Express.json());
app.use(Express.static("public"));

// --- BANチェックヘルパー ---
async function checkBan(req, res, next) {
    const ip = req.headers["x-forwarded-for"] || "unknown";
    const banEntry = await kv.get(["banned_ips", ip]);
    if (banEntry.value) return res.status(403).json({ error: "アクセス制限中" });
    next();
}

// --- 認証系 ---
app.post("/api/register", checkBan, async (req, res) => {
    const { userId, password, displayName } = req.body;
    const existing = await kv.get(["users", userId]);
    if (existing.value) return res.status(400).json({ error: "ID重複" });
    const ip = req.headers["x-forwarded-for"] || "unknown";
    let isFirst = true;
    for await (const _ of kv.list({ prefix: ["users"] }, { limit: 1 })) { isFirst = false; }
    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst, ip, blockList: [] };
    await kv.set(["users", userId], user);
    res.json({ success: true, user });
});

app.post("/api/login", checkBan, async (req, res) => {
    const { userId, password } = req.body;
    const user = await kv.get(["users", userId]);
    if (user.value && user.value.password === password) res.json({ success: true, user: user.value });
    else res.status(401).json({ error: "認証失敗" });
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
    } else res.status(404).send();
});

// --- 通知・緊急メッセージ ---
app.get("/api/emergency", async (req, res) => {
    const entry = await kv.get(["emergency_message"]);
    res.json(entry.value || null);
});

app.get("/api/notifications/:userId", async (req, res) => {
    const notes = [];
    const iter = kv.list({ prefix: ["notifications", req.params.userId] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) {
        if (!entry.value.read) notes.push(entry.value);
    }
    res.json(notes);
});

app.post("/api/notifications/read", async (req, res) => {
    const { userId } = req.body;
    const iter = kv.list({ prefix: ["notifications", userId] });
    for await (const entry of iter) {
        const note = entry.value;
        note.read = true;
        await kv.set(entry.key, note);
    }
    res.json({ success: true });
});

// 管理者用API
app.post("/api/admin/emergency", async (req, res) => {
    const { adminId, message } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (!admin.value?.isAdmin) return res.status(403).send();
    await kv.set(["emergency_message"], { message, createdAt: new Date().getTime().toString() });
    res.json({ success: true });
});

app.post("/api/admin/notify", async (req, res) => {
    const { adminId, targetUserId, message, isEmergency } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (!admin.value?.isAdmin) return res.status(403).send();
    const id = Date.now().toString();
    // isEmergencyがtrueなら、ユーザーの画面に強制表示されるフラグ
    await kv.set(["notifications", targetUserId, id], { id, message, createdAt: new Date().getTime().toString(), read: false, isEmergency: !!isEmergency });
    res.json({ success: true });
});

app.post("/api/admin/delete", async (req, res) => {
    const { postId, adminId } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (admin.value?.isAdmin) await kv.delete(["posts", postId]);
    res.json({ success: true });
});

app.get("/api/admin/reports", async (req, res) => {
    const reports = [];
    const iter = kv.list({ prefix: ["reports"] }, { reverse: true, consistency: "strong" });
    for await (const entry of iter) { reports.push(entry.value); }
    res.json(reports);
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
