import Express from "npm:express@4.18.2";
const app = Express();
const kv = await Deno.openKv();

app.use(Express.json());
app.use(Express.static("public"));

// --- ユーザー認証 ---
app.post("/api/register", async (req, res) => {
    const { userId, password, displayName } = req.body;
    if(!userId || !password) return res.status(400).json({ error: "IDとPWは必須です" });
    const existing = await kv.get(["users", userId]);
    if (existing.value) return res.status(400).json({ error: "既に存在するIDです" });
    let isFirst = true;
    for await (const _ of kv.list({ prefix: ["users"] }, { limit: 1 })) { isFirst = false; }
    // blockList: ブロックした人のIDリスト
    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst, blockList: [] };
    await kv.set(["users", userId], user);
    res.json({ success: true, user });
});

app.post("/api/login", async (req, res) => {
    const { userId, password } = req.body;
    const user = await kv.get(["users", userId]);
    if (user.value && user.value.password === password) {
        res.json({ success: true, user: user.value });
    } else {
        res.status(401).json({ error: "IDまたはパスワードが違います" });
    }
});

// --- ブロック機能 ---
app.post("/api/user/block", async (req, res) => {
    const { userId, targetId } = req.body;
    const userEntry = await kv.get(["users", userId]);
    if (userEntry.value) {
        const user = userEntry.value;
        if (!user.blockList) user.blockList = [];
        if (!user.blockList.includes(targetId)) user.blockList.push(targetId);
        await kv.set(["users", userId], user);
        res.json({ success: true, blockList: user.blockList });
    }
});

// --- 掲示板API (ブロック反映) ---
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
        // ブロックしているユーザーの投稿は除外
        if (blockerList.includes(p.userId)) continue;
        if (q) {
            const searchStr = (p.title + p.content + (p.tags || []).join('')).toLowerCase();
            if (!searchStr.includes(q.toLowerCase())) continue;
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

// --- 通知・通報・管理API (既存通り) ---
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

app.post("/api/admin/delete", async (req, res) => {
    const { postId, adminId } = req.body;
    const user = await kv.get(["users", adminId]);
    if (user.value?.isAdmin) await kv.delete(["posts", postId]);
    res.json({ success: true });
});

app.listen(8000);
