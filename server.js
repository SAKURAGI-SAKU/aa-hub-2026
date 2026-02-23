const express = require('express');
const session = require('express-session');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const prisma = new PrismaClient();

app.set('view engine', 'ejs');
// ★容量制限を10MBに拡大（Payload Too Large対策）
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false
}));

app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session.userId) {
        const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
        res.locals.user = user;
    }
    next();
});

// トップページ
app.get('/', async (req, res) => {
    const posts = await prisma.aAPost.findMany({
        include: { author: true, likes: true, _count: { select: { likes: true } } },
        orderBy: { createdAt: 'desc' }
    });
    res.render('index', { posts });
});

// ★個別ページ機能： /post/123 で特定のAAだけ表示
app.get('/post/:id', async (req, res) => {
    const post = await prisma.aAPost.findUnique({
        where: { id: parseInt(req.params.id) },
        include: { author: true, likes: true, _count: { select: { likes: true } } }
    });
    if (!post) return res.status(404).send('投稿が見つかりません');
    res.render('index', { posts: [post] }); // 1つだけ配列にして渡す
});

// ★削除機能： 投稿者本人だけが消せる
app.post('/post/:id/delete', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const postId = parseInt(req.params.id);
    const post = await prisma.aAPost.findUnique({ where: { id: postId } });
    
    if (post && post.authorId === req.session.userId) {
        await prisma.like.deleteMany({ where: { postId } }); // 紐づくいいねを先に消す
        await prisma.aAPost.delete({ where: { id: postId } });
    }
    res.redirect('/');
});

// --- 以下、既存の認証・投稿・いいね処理 ---
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await prisma.user.create({ data: { username, password: hashedPassword } });
        res.redirect('/login');
    } catch (e) { res.status(400).send('そのユーザー名はすでに使われています。'); }
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        res.redirect('/');
    } else { res.status(401).send('ユーザー名かパスワードが間違っています。'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/post', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { title, content } = req.body;
    await prisma.aAPost.create({ data: { title, content, authorId: req.session.userId } });
    res.redirect('/');
});

app.post('/like/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const postId = parseInt(req.params.id);
    try {
        await prisma.like.create({ data: { userId: req.session.userId, postId } });
    } catch (e) {
        await prisma.like.deleteMany({ where: { userId: req.session.userId, postId } });
    }
    res.redirect('back'); // 元いたページに戻る
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
