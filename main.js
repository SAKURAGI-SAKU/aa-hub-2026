import Express from "npm:express@4.18.2";
const app = Express();

// Deno KV（データベース）の準備
const kv = await Deno.openKv();

app.use(Express.json());

// --- 認証用ヘルパー ---
// クッキーの代わりにシンプルなLocalStorageを使った擬似セッションをフロントで管理します

// --- API ルート ---

// 1. ユーザー登録
app.post("/api/register", async (req, res) => {
  const { userId, password, displayName } = req.body;
  
  // 既にユーザーがいるか確認
  const existing = await kv.get(["users", userId]);
  if (existing.value) return res.status(400).json({ error: "既に存在するIDです" });

  // 全ユーザーリストを確認し、一人目ならAdminにする
  const userList = [];
  for await (const entry of kv.list({ prefix: ["users"] })) {
    userList.push(entry);
  }
  const isAdmin = userList.length === 0;

  const user = { userId, password, displayName, isAdmin };
  await kv.set(["users", userId], user);
  res.json({ success: true, user: { userId, displayName, isAdmin } });
});

// 2. ログイン
app.post("/api/login", async (req, res) => {
  const { userId, password } = req.body;
  const user = await kv.get(["users", userId]);
  
  if (user.value && user.value.password === password) {
    res.json({ success: true, user: user.value });
  } else {
    res.status(401).json({ error: "IDまたはパスワードが違います" });
  }
});

// 3. 投稿取得 (KVから取得)
app.get("/api/posts", async (req, res) => {
  const posts = [];
  const iter = kv.list({ prefix: ["posts"] }, { reverse: true });
  for await (const entry of iter) {
    posts.push(entry.value);
  }
  res.json(posts);
});

// 4. 新規投稿 (KVへ保存)
app.post("/api/posts", async (req, res) => {
  const { title, content, author } = req.body;
  const id = Date.now().toString();
  const newPost = { id, title, content, author: author || "GUEST", createdAt: new Date() };
  await kv.set(["posts", id], newPost);
  res.json({ success: true });
});

// --- メイン画面 (HTML) ---
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>AA HUB 2026</title>
        <style>
            body { font-family: sans-serif; background: #f4f4f9; padding: 20px; max-width: 800px; margin: 0 auto; }
            .aa-content { 
                font-family: "Mona", "MS PGothic", "ＭＳ Ｐゴシック", sans-serif; 
                font-size: 16px; line-height: 1.1; white-space: pre; 
                overflow-x: auto; background: #fff; padding: 15px; border: 1px solid #ccc;
            }
            .card { background: white; padding: 15px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            input, textarea { width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 8px; }
            .admin-badge { background: #ff4757; color: white; padding: 2px 5px; border-radius: 3px; font-size: 12px; }
            #auth-section { margin-bottom: 20px; text-align: right; }
            .hidden { display: none; }
        </style>
    </head>
    <body>
        <div id="auth-section">
            <div id="guest-zone">
                <input id="reg-id" placeholder="ID" style="width:100px">
                <input id="reg-pw" type="password" placeholder="パスワード" style="width:100px">
                <input id="reg-name" placeholder="表示名" style="width:100px">
                <button onclick="auth('register')">登録</button> | 
                <button onclick="auth('login')">ログイン</button>
            </div>
            <div id="user-zone" class="hidden">
                <span id="welcome-msg"></span>
                <button onclick="logout()">ログアウト</button>
            </div>
        </div>

        <h1>AA HUB 2026</h1>
        
        <div class="card" id="post-form">
            <input id="title" placeholder="タイトル">
            <textarea id="content" placeholder="AAを貼り付け"></textarea>
            <button onclick="postAA()" style="width:100%; padding:10px; background:#1e90ff; color:white; border:none; border-radius:5px; cursor:pointer;">作品を投稿する</button>
        </div>

        <div id="post-list"></div>

        <script>
            let currentUser = JSON.parse(localStorage.getItem('aa_user') || 'null');

            function updateUI() {
                if(currentUser) {
                    document.getElementById('guest-zone').classList.add('hidden');
                    document.getElementById('user-zone').classList.remove('hidden');
                    document.getElementById('welcome-msg').innerHTML = \`こんにちは、\${currentUser.displayName}さん \${currentUser.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}\`;
                } else {
                    document.getElementById('guest-zone').classList.remove('hidden');
                    document.getElementById('user-zone').classList.add('hidden');
                }
            }

            async function auth(type) {
                const userId = document.getElementById('reg-id').value;
                const password = document.getElementById('reg-pw').value;
                const displayName = document.getElementById('reg-name').value;
                
                const res = await fetch('/api/' + type, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId, password, displayName })
                });
                const data = await res.json();
                if(data.success) {
                    currentUser = data.user;
                    localStorage.setItem('aa_user', JSON.stringify(currentUser));
                    updateUI();
                } else {
                    alert(data.error || 'エラーが発生しました');
                }
            }

            function logout() {
                localStorage.removeItem('aa_user');
                currentUser = null;
                updateUI();
            }

            async function loadPosts() {
                const res = await fetch('/api/posts');
                const data = await res.json();
                document.getElementById('post-list').innerHTML = data.map(p => \`
                    <div class="card">
                        <small>投稿者: \${p.author} | \${new Date(p.createdAt).toLocaleString()}</small>
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
                    body: JSON.stringify({ 
                        title, 
                        content, 
                        author: currentUser ? currentUser.displayName : "名無しさん" 
                    })
                });
                document.getElementById('title').value = '';
                document.getElementById('content').value = '';
                loadPosts();
            }

            updateUI();
            loadPosts();
        </script>
    </body>
    </html>
  `);
});

app.listen(8000);
