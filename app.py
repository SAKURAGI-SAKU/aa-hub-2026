from flask import Flask, render_template, request, redirect

app = Flask(__name__)

# 投稿データを保存するリスト
posts = [
    {"title": "サンプル", "content": "（ ＾ω＾）おっ"}
]

@app.route('/')
def index():
    return render_template('index.html', posts=posts)

@app.route('/post', methods=['POST'])
def post():
    title = request.form.get('title')
    content = request.form.get('content')
    if title and content:
        posts.insert(0, {"title": title, "content": content})
    return redirect('/')

if __name__ == '__main__':
    app.run(debug=True)
