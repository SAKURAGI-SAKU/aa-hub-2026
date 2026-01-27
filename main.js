import Express from "npm:express@4.18.2";
const app = Express();

app.use(Express.json());
app.use(Express.static("public")); // 画像やCSSを入れる場所

// 簡易データベース（メモリ保存：再起動すると消えますが、最初はこれでOK）
let posts = [
  { id: 1, title: "初投稿", content: " ∧＿∧\n（　´∀｀）＜ ぬるぽ", author: "Admin" }
];

// AA投稿一覧を取得するAPI
app.get("/api/posts", (req, res) => {
  res.json(posts);
});

// 新しいAAを投稿するAPI
app.post("/api/posts", (req, res) => {
  const { title, content } = req.body;
  const newPost = { id: Date.now(), title, content, author: "GUEST" };
  posts.push(newPost);
  res.json({ success: true });
});

// サーバー起動（Deno Deploy用）
const port = 8000;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
