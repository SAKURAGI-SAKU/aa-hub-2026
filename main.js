import Express from "npm:express@4.18.2";
import path from "node:path";

const app = Express();
const kv = await Deno.openKv();

app.use(Express.json());

// publicフォルダの中身を自動的に公開する設定
app.use(Express.static("public"));

// --- APIルート (前回の内容を維持) ---

// ユーザー登録
app.post("/api/register", async (req, res) => {
    const { userId, password, displayName } = req.body;
    if(!userId || !password) return res.status(400).json({ error: "入力が足りません" });

    const existing = await kv.get(["users", userId]);
    if (existing.value) return res.status(400).json({ error: "既に存在するIDです" });
    
    let isFirst = true;
    for await (const _ of kv.list({ prefix: ["users"] }, { limit: 1 })) { isFirst = false; }

    const user = { userId, password, displayName: displayName || userId, isAdmin: isFirst };
    await kv.set(["users", userId], user);
    res.json({ success: true, user });
});

// ログイン
app.post("/api/login", async (req, res) => {
    const { userId, password } = req.body;
    const user = await kv.get(["users", userId]);
    if (user.value && user.value.password === password) {
        res.json({ success: true, user: user.value });
    } else {
        res.status(401).json({ error: "IDまたはパスワードが違います" });
    }
});

// 投稿一覧
app.get("/api/posts", async (req, res) => {
    const posts = [];
    const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
    for await (const entry of iter) { posts.push(entry.value); }
    res.json(posts);
});

// 投稿保存
app.post("/api/posts", async (req, res) => {
    const { title, content, author } = req.body;
    const id = Date.now().toString();
    const newPost = { id, title, content, author, createdAt: new Date() };
    await kv.set(["posts", id], newPost);
    res.json({ success: true });
});

// サーバー起動
app.listen(8000);
