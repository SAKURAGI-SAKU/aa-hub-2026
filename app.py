import os
from flask import Flask, render_template, request, redirect
from supabase import create_client

app = Flask(__name__)

# Supabaseの設定（後でRenderの管理画面で設定します）
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase = create_client(url, key)

@app.route('/')
def index():
    # データベースから新しい順に投稿を取得
    response = supabase.table("posts").select("*").order("created_at", desc=True).execute()
    return render_template('index.html', posts=response.data)

@app.route('/post', methods=['POST'])
def post():
    title = request.form.get('title')
    content = request.form.get('content')
    if title and content:
        # データベースに保存
        supabase.table("posts").insert({"title": title, "content": content}).execute()
    return redirect('/')

if __name__ == '__main__':
    # Renderの環境変数 PORT を使うように修正
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
