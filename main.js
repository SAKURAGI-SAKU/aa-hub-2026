import Express from "npm:express@4.18.2";
const app = Express();

// データベース(Deno KV)を安全に開く
const kv = await Deno.openKv();

app.use(Express.json());
app.use(Express.static("public"));

// --- ユーザー認証API (変更なし) ---
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

// 投稿API (連続投稿制限をサーバー側でチェック)
app.post("/api/posts", async (req, res) => {
    const { title, content, author, userId } = req.body;

    // 連続投稿チェック (簡易的に最後の投稿日時をチェック)
    if (userId) {
        const lastPost = await kv.get(["user_last_post", userId]);
        if (lastPost.value && Date.now() - lastPost.value < 60000) { // 60秒制限
            return res.status(429).json({ error: "連続投稿は60秒間制限されています。" });
        }
        await kv.set(["user_last_post", userId], Date.now());
    }

    const id = Date.now().toString();
    // likedBy: いいねしたユーザーIDのリストを追加
    const newPost = { id, title, content, author, likes: 0, likedBy: [], createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    res.json({ success: true });
});

// いいねAPI (重複防止チェック)
app.post("/api/posts/:id/like", async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body; // フロントからユーザーIDを受け取る
    if (!userId) return res.status(401).json({ error: "ログインしてください" });

    const postKey = ["posts", id];
    const post = await kv.get(postKey);

    if (post.value) {
        const updatedPost = post.value;
        // 既にいいねしていないかチェック
        if (updatedPost.likedBy.includes(userId)) {
            return res.status(400).json({ error: "既にお気に入り済みです" });
        }

        updatedPost.likes = (updatedPost.likes || 0) + 1;
        updatedPost.likedBy.push(userId);
        await kv.set(postKey, updatedPost);
        res.json({ success: true, likes: updatedPost.likes });
    } else {
        res.status(404).send();
    }
});

app.listen(8000);
