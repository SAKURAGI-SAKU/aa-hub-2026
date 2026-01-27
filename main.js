import Express from "npm:express@4.18.2";
import path from "node:path";
const app = Express();

app.use(Express.json());

// 簡易データベース（メモリ保持）
let posts = [
  { id: 1, title: "テスト投稿", content: " ∧＿∧\n（　´∀｀）＜ ぬるぽ", author: "Admin" }
];

// --- API ルート ---

// 投稿一覧を取得
app.get("/api/posts", (req, res) => {
  res.json(posts);
});

// 新規投稿
app.post("/api/posts", (req, res) => {
  const { title, content } = req.body;
  const newPost = { id: Date.now(), title, content, author: "GUEST" };
  posts.push(newPost);
  res.json({ success: true });
});

// --- 表示ルート ---

// トップ画面（ここが / にアクセスした時に表示される）
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>AA HUB 2026</title>
        <style>
            body { font-family: sans-serif; background: #f0f0f0; padding: 20px; }
            .aa-content { 
                font-family: "Mona", "MS PGothic", "ＭＳ Ｐゴシック", sans-serif; 
                font-size: 16px; line-height: 1.1; white-space: pre; 
                overflow-x: auto; background: #fff; padding: 15px; border: 1px solid #ccc;
            }
            .post-card { background: white; margin-bottom: 20px; padding: 10px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            textarea { width: 100%; height: 100px; }
        </style>
    </head>
    <body>
        <h1>AA HUB 2026 (Beta)</h1>
        <div style="background: white; padding: 20px; border-radius: 5px;">
            <input id="title" placeholder="タイトル" style="width:100%"><br><br>
            <textarea id="content" placeholder="AAを貼り付け"></textarea><br><br>
            <button onclick="postAA()" style="padding:10px 20px;">投稿する</button>
        </div>
        <hr>
        <div id="post-list"></div>

        <script>
            async function loadPosts() {
                const res = await fetch('/api/posts');
                const data = await res.json();
                document.getElementById('post-list').innerHTML = data.reverse().map(p => \`
                    <div class="post-card">
                        <h3>\${p.title}</h3>
                        <div class="aa-content">\${p.content}</div>
                    </div>
                \`).join('');
            }
            async function postAA() {
                const title = document.getElementById('title').value;
                const content = document.getElementById('content').value;
                if(!title || !content) return alert('入力してください');
                await fetch('/api/posts', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ title, content })
                });
                document.getElementById('title').value = '';
                document.getElementById('content').value = '';
                loadPosts();
            }
            loadPosts();
        </script>
    </body>
    </html>
  `);
});

const port = 8000;
app.listen(port, () => {
  console.log("Server started!");
});
