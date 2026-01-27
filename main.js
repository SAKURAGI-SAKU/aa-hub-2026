import Express from "npm:express@4.18.2";
const app = Express();
const kv = await Deno.openKv();

app.use(Express.json());
app.use(Express.static("public"));

// --- ユーザー認証API ---
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

app.post("/api/posts", async (req, res) => {
    const { title, content, author, userId } = req.body;
    if (!userId) return res.status(401).json({ error: "ログインが必要です" });
    
    const lastPostKey = ["user_last_post", userId];
    const lastPost = await kv.get(lastPostKey);
    const now = Date.now();
    if (lastPost.value && now - lastPost.value < 10000) { 
        return res.status(429).json({ error: "連打防止：10秒待ってください" });
    }
    
    const id = now.toString();
    const newPost = { id, title, content, author, userId, likes: 0, likedBy: [], createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    await kv.set(lastPostKey, now);
    res.json({ success: true });
});

app.post("/api/posts/:id/like", async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(401).json({ error: "ログインしてください" });
    const postKey = ["posts", id];
    const post = await kv.get(postKey);
    if (post.value) {
        const updated = post.value;
        if (updated.likedBy.includes(userId)) return res.status(400).json({ error: "済み" });
        updated.likes = (updated.likes || 0) + 1;
        updated.likedBy.push(userId);
        await kv.set(postKey, updated);
        res.json({ success: true, likes: updated.likes });
    } else { res.status(404).send(); }
});

// ★管理者用：削除API
app.post("/api/admin/delete", async (req, res) => {
    const { postId, adminId } = req.body;
    const user = await kv.get(["users", adminId]);
    if (!user.value || !user.value.isAdmin) return res.status(403).json({ error: "権限なし" });
    
    await kv.delete(["posts", postId]);
    res.json({ success: true });
});

app.listen(8000);
