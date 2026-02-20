// server.js
const express = require('express');
const session = require('express-session');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const prisma = new PrismaClient();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_key',
    resave: false,
    saveUninitialized: false
}));

// ミドルウェア: ログイン中のユーザー情報をテンプレートに渡す
app.use(async (req, res, next) => {
    res.locals.user = null;
    if (req.session.userId) {
        const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
        res.locals.user = user;
    }
    next();
});

// トップページ（タイムライン）
app.get('/', async (req, res) => {
    const posts = await prisma.aAPost.findMany({
        include: {
            author: true,
            likes: true,
            _count: { select: { likes: true } }
        },
        orderBy: { createdAt: 'desc' }
    });
    res.render('index', { posts });
});

// ユーザー登録画面と処理
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        await prisma.user.create({ data: { username, password: hashedPassword } });
        res.redirect('/login');
    } catch (e) {
        res.status(400).send('そのユーザー名はすでに使われています。');
    }
});

// ログイン画面と処理
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = user.id;
        res.redirect('/');
    } else {
        res.status(401).send('ユーザー名かパスワードが間違っています。');
    }
});

// ログアウト処理
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// 投稿処理
app.post('/post', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { title, content } = req.body;
    await prisma.aAPost.create({
        data: { title, content, authorId: req.session.userId }
    });
    res.redirect('/');
});

// いいね処理
app.post('/like/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const postId = parseInt(req.params.id);
    try {
        await prisma.like.create({
            data: { userId: req.session.userId, postId }
        });
    } catch (e) {
        // すでにいいねしている場合は削除する（いいね取り消し）
        await prisma.like.deleteMany({
            where: { userId: req.session.userId, postId }
        });
    }
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
