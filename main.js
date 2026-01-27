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
    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst };
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

// --- 掲示板API ---
app.get("/api/posts", async (req, res) => {
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
    for await (const entry of iter) { posts.push(entry.value); }
    res.json(posts);
});

app.get("/api/users/:userId/posts", async (req, res) => {
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
    for await (const entry of iter) {
        if (entry.value.userId === req.params.userId) posts.push(entry.value);
    }
    res.json(posts);
});

app.post("/api/posts", async (req, res) => {
    const { title, content, author, userId } = req.body;
    const lastPostKey = ["user_last_post", userId];
    const lastPost = await kv.get(lastPostKey);
    const now = Date.now();
    if (lastPost.value && now - lastPost.value < 10000) return res.status(429).json({ error: "10秒待ってください" });
    const id = now.toString();
    const newPost = { id, title, content, author, userId, likes: 0, likedBy: [], createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    await kv.set(lastPostKey, now);
    res.json({ success: true });
});

app.post("/api/posts/:id/like", async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const postKey = ["posts", id];
    const post = await kv.get(postKey);
    if (post.value) {
        const updated = post.value;
        if (updated.likedBy.includes(userId)) return res.status(400).send();
        updated.likes = (updated.likes || 0) + 1;
        updated.likedBy.push(userId);
        await kv.set(postKey, updated);
        res.json({ success: true, likes: updated.likes });
    } else { res.status(404).send(); }
});

app.post("/api/report", async (req, res) => {
    const { postId, userId, reason, postAuthorId } = req.body;
    const id = Date.now().toString();
    await kv.set(["reports", id], { id, postId, reporterId: userId, targetUserId: postAuthorId, reason, createdAt: new Date() });
    res.json({ success: true });
});

// --- 通知機能 ---
app.post("/api/admin/notify", async (req, res) => {
    const { adminId, targetUserId, message } = req.body;
    const admin = await kv.get(["users", adminId]);
    if (!admin.value || !admin.value.isAdmin) return res.status(403).send();
    const id = Date.now().toString();
    await kv.set(["notifications", targetUserId, id], { id, message, createdAt: new Date() });
    res.json({ success: true });
});

app.get("/api/notifications/:userId", async (req, res) => {
    const notes = [];
    const iter = kv.list({ prefix: ["notifications", req.params.userId] }, { reverse: true });
    for await (const entry of iter) { notes.push(entry.value); }
    res.json(notes);
});

// --- 管理者API ---
app.get("/api/admin/reports", async (req, res) => {
    const reports = [];
    const iter = kv.list({ prefix: ["reports"] }, { reverse: true });
    for await (const entry of iter) { reports.push(entry.value); }
    res.json(reports);
});

app.post("/api/admin/delete", async (req, res) => {
    const { postId, adminId } = req.body;
    const user = await kv.get(["users", adminId]);
    if (!user.value || !user.value.isAdmin) return res.status(403).send();
    await kv.delete(["posts", postId]);
    res.json({ success: true });
});

app.listen(8000);
