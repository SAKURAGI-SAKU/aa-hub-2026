import os
from flask import Flask, render_template, request, redirect
from supabase import create_client, Client

app = Flask(__name__)

# Renderの環境変数から取得
url: str = os.environ.get("SUPABASE_URL", "")
key: str = os.environ.get("SUPABASE_KEY", "")

# どちらかが欠けているとエラーになるのでチェック
if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_KEY is missing!")
else:
    supabase: Client = create_client(url, key)

@app.route('/')
def index():
    try:
        # 投稿データを取得
        response = supabase.table("posts").select("*").order("created_at", desc=True).execute()
        return render_template('index.html', posts=response.data)
    except Exception as e:
        print(f"Database Error: {e}")
        return render_template('index.html', posts=[])

@app.route('/post', methods=['POST'])
def post():
    title = request.form.get('title')
    content = request.form.get('content')
    if title and content:
        try:
            # データを挿入
            supabase.table("posts").insert({"title": title, "content": content}).execute()
        except Exception as e:
            print(f"Post Error: {e}")
    return redirect('/')

if __name__ == '__main__':
    # Renderで動かすためのポート設定
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
