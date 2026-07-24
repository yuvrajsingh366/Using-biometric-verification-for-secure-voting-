from flask import (Flask, render_template, request, redirect,
                   url_for, session, jsonify, flash)
import sqlite3, os, random, string, secrets, smtplib, json, math
from email.mime.text import MIMEText
from werkzeug.utils import secure_filename
from datetime import datetime

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

BASE_DIR      = os.path.dirname(__file__)
DB            = os.path.join(BASE_DIR, "evm.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static/uploads/symbols")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

FACE_MATCH_THRESHOLD = 0.45   # euclidean distance; < 0.45 = same person

SMTP_EMAIL    = "evmproject922@gmail.com"
SMTP_PASSWORD = "lmxzhjpwxfrhshyn"

def send_email_otp(email, otp):
    try:
        msg = MIMEText(f"""Dear Voter,

Your One-Time Password (OTP) for accessing the online voting system is:

OTP: {otp}

Please enter this OTP on the verification page to continue with the voting process.
This OTP is valid for the next 5 minutes. Do not share it with anyone.

If you did not request this OTP, please ignore this email.

Thank you,
Election System Administrator""")
        msg["Subject"] = "Your OTP for Election Voting Verification"
        msg["From"]    = SMTP_EMAIL
        msg["To"]      = email
        s = smtplib.SMTP_SSL("smtp.gmail.com", 465)
        s.login(SMTP_EMAIL, SMTP_PASSWORD)
        s.sendmail(SMTP_EMAIL, email, msg.as_string())
        s.quit()
        return True
    except Exception as e:
        print("Email error:", e)
        return False

# ════════════════════════════════════════════════════════════════════
#  BIOMETRIC HELPERS  (no OpenCV/dlib — uses face-api.js descriptors)
# ════════════════════════════════════════════════════════════════════

def euclidean(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

def face_duplicate_check(new_desc, conn):
    """Return voter_id of duplicate face or None."""
    rows = conn.execute(
        "SELECT voter_id, face_descriptor FROM voters WHERE face_descriptor IS NOT NULL"
    ).fetchall()
    for row in rows:
        try:
            stored = json.loads(row["face_descriptor"])
            if euclidean(new_desc, stored) < FACE_MATCH_THRESHOLD:
                return row["voter_id"]
        except Exception:
            continue
    return None

def face_matches_stored(live_desc, stored_json):
    """Return (is_match, distance)."""
    try:
        stored = json.loads(stored_json)
        dist   = euclidean(live_desc, stored)
        return dist < FACE_MATCH_THRESHOLD, dist
    except Exception:
        return False, 999.0

def fp_is_duplicate(fp_token, conn):
    """Return voter_id of duplicate fingerprint or None."""
    if not fp_token or fp_token.startswith("FP_SKIPPED"):
        return None
    # Strip VERIFY prefix for comparison
    clean = fp_token.replace("FP_VERIFY_", "FP_", 1)
    row = conn.execute(
        "SELECT voter_id FROM voters WHERE fingerprint=? OR fingerprint=?",
        (fp_token, clean)
    ).fetchone()
    return row["voter_id"] if row else None

def fp_matches_stored(live_token, stored_token):
    """
    Return True if live fingerprint token matches the stored one.
    Both FP_<hex> (registration) and FP_VERIFY_<hex> (verification)
    are compared by extracting just the raw hex portion.
    """
    if not stored_token or stored_token.startswith("FP_SKIPPED"):
        return True   # voter registered without fingerprint — allow through
    if not live_token or live_token.startswith("FP_SKIPPED"):
        return False  # fingerprint required but voter didn't scan

    def raw(t):
        # Strip any prefix: FP_VERIFY_ or FP_  → bare hex token
        t = t.strip()
        if t.startswith("FP_VERIFY_"):
            return t[len("FP_VERIFY_"):]
        if t.startswith("FP_"):
            return t[len("FP_"):]
        return t

    return raw(live_token) == raw(stored_token)

# ════════════════════════════════════════════════════════════════════
#  DATABASE
# ════════════════════════════════════════════════════════════════════

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def _col_exists(cursor, table, col):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cursor.fetchall())

def init_db():
    conn = get_db()
    c    = conn.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS voters(
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        voter_id         TEXT UNIQUE,
        name             TEXT,
        email            TEXT,
        phone            TEXT,
        password         TEXT,
        face_image       TEXT,
        face_descriptor  TEXT,
        fingerprint      TEXT,
        has_voted        INTEGER DEFAULT 0,
        registered_at    TEXT DEFAULT (datetime('now','localtime'))
    )""")

    _voter_cols = {
        "phone":          "TEXT",
        "face_image":     "TEXT",
        "face_descriptor":"TEXT",
        "fingerprint":    "TEXT",
        "registered_at":  "TEXT DEFAULT (datetime('now','localtime'))",
    }
    for col, typedef in _voter_cols.items():
        if not _col_exists(c, "voters", col):
            c.execute(f"ALTER TABLE voters ADD COLUMN {col} {typedef}")
            print(f"[DB MIGRATE] voters.{col} added")

    c.execute("""
    CREATE TABLE IF NOT EXISTS candidates(
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT,
        party        TEXT,
        party_symbol TEXT DEFAULT '⭐',
        party_color  TEXT DEFAULT '#1a4fa0',
        symbol_image TEXT,
        manifesto    TEXT,
        vote_count   INTEGER DEFAULT 0
    )""")

    _cand_cols = {
        "party_symbol": "TEXT DEFAULT '⭐'",
        "party_color":  "TEXT DEFAULT '#1a4fa0'",
        "symbol_image": "TEXT",
        "manifesto":    "TEXT",
    }
    for col, typedef in _cand_cols.items():
        if not _col_exists(c, "candidates", col):
            c.execute(f"ALTER TABLE candidates ADD COLUMN {col} {typedef}")

    c.execute("""CREATE TABLE IF NOT EXISTS otp_store(email TEXT PRIMARY KEY, otp TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS audit_log(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT DEFAULT (datetime('now','localtime')),
        action     TEXT, voter_id TEXT, details TEXT, ip_address TEXT
    )""")

    c.execute("INSERT OR IGNORE INTO settings VALUES('election_name','General Election 2026')")
    c.execute("INSERT OR IGNORE INTO settings VALUES('election_date','')")
    c.execute("INSERT OR IGNORE INTO settings VALUES('election_active','1')")
    conn.commit()
    conn.close()

def get_settings():
    conn = get_db()
    rows = conn.execute("SELECT key,value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}

@app.context_processor
def inject_settings():
    return dict(settings=get_settings())

@app.context_processor
def inject_static_ver():
    """
    Computes the latest mtime across all JS and CSS static files.
    Used as ?v=<timestamp> cache-buster in base.html <script> tags.
    Any time you edit a JS or CSS file, browsers will re-fetch it automatically.
    """
    import glob
    static_dir = os.path.join(BASE_DIR, "static")
    files = glob.glob(os.path.join(static_dir, "**", "*.js"),  recursive=True) +             glob.glob(os.path.join(static_dir, "**", "*.css"), recursive=True)
    ver = int(max((os.path.getmtime(f) for f in files), default=0))
    return dict(static_ver=ver)

def generate_otp():
    return "".join(random.choices(string.digits, k=6))

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

def log_action(action, voter_id=None, details=None):
    ip = request.remote_addr or "unknown"
    conn = get_db()
    conn.execute(
        "INSERT INTO audit_log(action,voter_id,details,ip_address) VALUES(?,?,?,?)",
        (action, voter_id, details, ip)
    )
    conn.commit()
    conn.close()

def admin_required():
    return bool(session.get("admin"))

@app.errorhandler(500)
def handle_500(e):
    return jsonify(success=False, message=f"Internal server error: {str(e)}"), 500

@app.errorhandler(413)
def handle_413(e):
    return jsonify(success=False, message="Request too large"), 413

# ════════════════════════════════════════════════════════════════════
#  HOME
# ════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    conn = get_db()
    total_voters = conn.execute("SELECT COUNT(*) FROM voters").fetchone()[0]
    total_votes  = conn.execute("SELECT COUNT(*) FROM voters WHERE has_voted=1").fetchone()[0]
    conn.close()
    return render_template("index.html", total_voters=total_voters, total_votes=total_votes)

# ════════════════════════════════════════════════════════════════════
#  REGISTER
# ════════════════════════════════════════════════════════════════════

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "GET":
        return render_template("register.html")

    data = request.get_json(silent=True)
    if not data:
        return jsonify(success=False, message="Invalid request — JSON body required")
    step = data.get("step")

    if step == "send_otp":
        email    = data.get("email", "").strip().lower()
        voter_id = data.get("voter_id", "").strip()
        phone    = data.get("phone", "").strip()
        if not voter_id: return jsonify(success=False, message="Voter ID is required")
        if not email:    return jsonify(success=False, message="Email is required")
        if not phone:    return jsonify(success=False, message="Phone is required")
        conn = get_db()
        if conn.execute("SELECT id FROM voters WHERE voter_id=?", (voter_id,)).fetchone():
            conn.close(); return jsonify(success=False, message="Voter ID already registered")
        if conn.execute("SELECT id FROM voters WHERE LOWER(email)=?", (email,)).fetchone():
            conn.close(); return jsonify(success=False, message="Email already registered")
        if conn.execute("SELECT id FROM voters WHERE phone=?", (phone,)).fetchone():
            conn.close(); return jsonify(success=False, message="Phone already registered")
        otp = generate_otp()
        conn.execute("INSERT OR REPLACE INTO otp_store(email,otp) VALUES(?,?)", (email, otp))
        conn.commit(); conn.close()
        send_email_otp(email, otp)
        log_action("OTP_SENT", voter_id, f"OTP sent to {email}")
        return jsonify(success=True, message="OTP sent")

    if step == "verify_otp":
        email = data.get("email", "").strip()
        otp   = data.get("otp", "").strip()
        conn  = get_db()
        row   = conn.execute("SELECT otp FROM otp_store WHERE email=?", (email,)).fetchone()
        conn.close()
        if not row or row["otp"] != otp:
            return jsonify(success=False, message="Invalid OTP")
        return jsonify(success=True)

    if step == "register":
        voter_id        = data.get("voter_id", "").strip()
        name            = data.get("name", "").strip()
        email           = data.get("email", "").strip().lower()
        phone           = data.get("phone", "").strip()
        password        = data.get("password", "")
        face_image      = data.get("face_image")
        face_descriptor = data.get("face_descriptor")   # 128-D float list
        fingerprint     = data.get("fingerprint", "").strip()

        if not all([voter_id, name, email, phone, password]):
            return jsonify(success=False, message="All fields are required")

        conn = get_db()
        if conn.execute("SELECT id FROM voters WHERE voter_id=?", (voter_id,)).fetchone():
            conn.close(); return jsonify(success=False, message="Voter ID already registered")
        if conn.execute("SELECT id FROM voters WHERE LOWER(email)=?", (email,)).fetchone():
            conn.close(); return jsonify(success=False, message="Email already registered")
        if conn.execute("SELECT id FROM voters WHERE phone=?", (phone,)).fetchone():
            conn.close(); return jsonify(success=False, message="Phone already registered")

        # ── SECURITY CHECK 1: Duplicate fingerprint ───────────────
        if fingerprint and not fingerprint.startswith("FP_SKIPPED"):
            dup = fp_is_duplicate(fingerprint, conn)
            if dup:
                conn.close()
                log_action("REG_FP_DUP", voter_id, f"Dup fingerprint — voter {dup}")
                return jsonify(success=False,
                    message="⚠️ This fingerprint is already registered. One person — one vote.")

        # ── SECURITY CHECK 2: Duplicate face ─────────────────────
        face_descriptor_json = None
        if face_descriptor and isinstance(face_descriptor, list) and len(face_descriptor) == 128:
            dup = face_duplicate_check(face_descriptor, conn)
            if dup:
                conn.close()
                log_action("REG_FACE_DUP", voter_id, f"Dup face — voter {dup}")
                return jsonify(success=False,
                    message="⚠️ This face is already registered. One person — one vote.")
            face_descriptor_json = json.dumps(face_descriptor)

        try:
            conn.execute(
                """INSERT INTO voters
                   (voter_id,name,email,phone,password,face_image,face_descriptor,fingerprint)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (voter_id, name, email, phone, password,
                 face_image, face_descriptor_json, fingerprint)
            )
            conn.commit()
            log_action("REGISTER", voter_id,
                       f"New voter: {name} | face={'yes' if face_descriptor_json else 'no'} "
                       f"| fp={'yes' if fingerprint else 'no'}")
            return jsonify(success=True, message="Registration complete")
        except sqlite3.IntegrityError:
            return jsonify(success=False, message="Duplicate entry")
        except Exception as e:
            print(f"[REGISTER ERROR] {e}")
            return jsonify(success=False, message=f"Server error: {str(e)}")
        finally:
            conn.close()

    return jsonify(success=False, message="Unknown step")

# ════════════════════════════════════════════════════════════════════
#  LOGIN  — password + fingerprint + face
# ════════════════════════════════════════════════════════════════════

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("login.html")

    data = request.get_json(silent=True)
    if not data:
        return jsonify(success=False, message="Invalid request")

    voter_id         = data.get("voter_id", "").strip().upper()
    password         = data.get("password", "")
    face_descriptor  = data.get("face_descriptor")       # 128-D float list
    fingerprint_live = data.get("fingerprint", "").strip()

    conn = get_db()
    user = conn.execute(
        "SELECT * FROM voters WHERE voter_id=? AND password=?", (voter_id, password)
    ).fetchone()
    conn.close()

    if not user:
        log_action("LOGIN_FAIL", voter_id, "Invalid credentials")
        return jsonify(success=False, message="Invalid Voter ID or password")
    if user["has_voted"]:
        log_action("LOGIN_BLOCKED", voter_id, "Already voted")
        return jsonify(success=False, message="You have already cast your vote")

    # ── SECURITY CHECK 3: Fingerprint at login ────────────────────
    stored_fp = user["fingerprint"] or ""
    if stored_fp and not stored_fp.startswith("FP_SKIPPED"):
        if not fingerprint_live or fingerprint_live.startswith("FP_SKIPPED"):
            log_action("LOGIN_FP_MISSING", voter_id)
            return jsonify(success=False, message="Fingerprint scan required to log in")
        if not fp_matches_stored(fingerprint_live, stored_fp):
            log_action("LOGIN_FP_FAIL", voter_id, "Fingerprint mismatch at login")
            return jsonify(success=False,
                           message="⚠️ Fingerprint does not match. Access denied.")

    # ── SECURITY CHECK 4: Face at login ───────────────────────────
    if user["face_descriptor"]:
        if not face_descriptor or not isinstance(face_descriptor, list):
            log_action("LOGIN_FACE_MISSING", voter_id)
            return jsonify(success=False, message="Live face verification required to log in")
        matched, dist = face_matches_stored(face_descriptor, user["face_descriptor"])
        if not matched:
            log_action("LOGIN_FACE_FAIL", voter_id, f"Face mismatch dist={dist:.3f}")
            return jsonify(success=False,
                           message=f"⚠️ Face verification failed (dist={dist:.2f}). Not the registered voter.")

    session["voter_id"] = voter_id
    log_action("LOGIN", voter_id, "Login OK — biometrics verified")
    return jsonify(success=True, redirect="/vote")

@app.route("/logout")
def logout():
    voter_id = session.get("voter_id")
    session.clear()
    if voter_id: log_action("LOGOUT", voter_id)
    return redirect(url_for("index"))

# ════════════════════════════════════════════════════════════════════
#  VOTE PAGE
# ════════════════════════════════════════════════════════════════════

@app.route("/vote")
def vote():
    if "voter_id" not in session:
        return redirect(url_for("login"))
    conn       = get_db()
    candidates = [dict(r) for r in conn.execute("SELECT * FROM candidates").fetchall()]
    voter_row  = conn.execute(
        "SELECT face_image, name FROM voters WHERE voter_id=?", (session["voter_id"],)
    ).fetchone()
    voter      = dict(voter_row) if voter_row else {}
    conn.close()
    voter_name = voter.get("name") or session.get("voter_id", "Voter")
    return render_template("vote.html", candidates=candidates, voter=voter, voter_name=voter_name)

# ════════════════════════════════════════════════════════════════════
#  CAST VOTE  — fingerprint + face re-check before recording
# ════════════════════════════════════════════════════════════════════

@app.route("/cast_vote", methods=["POST"])
def cast_vote():
    if "voter_id" not in session:
        return jsonify(success=False, message="Not logged in")

    data = request.get_json(silent=True)
    if not data:
        return jsonify(success=False, message="Invalid request")

    candidate_id     = data.get("candidate_id")
    face_descriptor  = data.get("face_descriptor")       # 128-D list
    fingerprint_live = data.get("fingerprint", "").strip()

    voter_id = session["voter_id"]
    conn     = get_db()
    voter    = conn.execute("SELECT * FROM voters WHERE voter_id=?", (voter_id,)).fetchone()

    if not voter:
        conn.close(); return jsonify(success=False, message="Voter not found")
    if voter["has_voted"]:
        conn.close(); return jsonify(success=False, message="Already voted")

    # ── SECURITY CHECK 5: Booth fingerprint ──────────────────────
    stored_fp = voter["fingerprint"] or ""
    if stored_fp and not stored_fp.startswith("FP_SKIPPED"):
        if not fingerprint_live or fingerprint_live.startswith("FP_SKIPPED"):
            conn.close()
            log_action("VOTE_FP_MISSING", voter_id)
            return jsonify(success=False, message="Fingerprint scan required before voting")
        if not fp_matches_stored(fingerprint_live, stored_fp):
            conn.close()
            log_action("VOTE_FP_FAIL", voter_id, "Fingerprint mismatch at booth")
            return jsonify(success=False, message="⚠️ Fingerprint mismatch at booth. Vote blocked.")

    # ── SECURITY CHECK 6: Booth face ─────────────────────────────
    if voter["face_descriptor"]:
        if not face_descriptor or not isinstance(face_descriptor, list):
            conn.close()
            log_action("VOTE_FACE_MISSING", voter_id)
            return jsonify(success=False, message="Live face scan required before voting")
        matched, dist = face_matches_stored(face_descriptor, voter["face_descriptor"])
        if not matched:
            conn.close()
            log_action("VOTE_FACE_FAIL", voter_id, f"Face mismatch at booth dist={dist:.3f}")
            return jsonify(success=False,
                           message=f"⚠️ Face mismatch at booth (dist={dist:.2f}). Vote blocked.")

    # ── All gates passed ──────────────────────────────────────────
    conn.execute("UPDATE candidates SET vote_count=vote_count+1 WHERE id=?", (candidate_id,))
    conn.execute("UPDATE voters SET has_voted=1 WHERE voter_id=?", (voter_id,))
    conn.commit(); conn.close()
    log_action("VOTE_CAST", voter_id,
               f"Voted candidate_id={candidate_id} — all biometrics verified")
    session.clear()
    return jsonify(success=True, message="Vote cast successfully!")

# ════════════════════════════════════════════════════════════════════
#  RESULTS / THANK YOU
# ════════════════════════════════════════════════════════════════════

@app.route("/results")
def results():
    conn       = get_db()
    candidates = [dict(r) for r in conn.execute(
        "SELECT * FROM candidates ORDER BY vote_count DESC").fetchall()]
    total      = conn.execute("SELECT COUNT(*) FROM voters WHERE has_voted=1").fetchone()[0]
    conn.close()
    return render_template("results.html", candidates=candidates, total=total)

@app.route("/thank_you")
def thank_you():
    return render_template("thank_you.html")

# ════════════════════════════════════════════════════════════════════
#  ADMIN
# ════════════════════════════════════════════════════════════════════

@app.route("/admin", methods=["GET", "POST"])
@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if session.get("admin"):
        return redirect("/admin/dashboard")
    if request.method == "POST":
        u = request.form.get("username", "")
        p = request.form.get("password", "")
        if u == "admin" and p == "admin123":
            session["admin"] = True; session["admin_user"] = u
            log_action("ADMIN_LOGIN", details=f"Admin '{u}' logged in")
            return redirect("/admin/dashboard")
        flash("Invalid admin credentials")
        log_action("ADMIN_LOGIN_FAIL", details=f"Failed for '{u}'")
    return render_template("admin_login.html")

@app.route("/admin/dashboard")
def admin_dashboard():
    if not admin_required(): return redirect("/admin/login")
    conn         = get_db()
    voters       = [dict(r) for r in conn.execute("SELECT * FROM voters ORDER BY id DESC").fetchall()]
    candidates   = [dict(r) for r in conn.execute("SELECT * FROM candidates ORDER BY id").fetchall()]
    logs         = [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT 200").fetchall()]
    total_voters = conn.execute("SELECT COUNT(*) FROM voters").fetchone()[0]
    total_votes  = conn.execute("SELECT COUNT(*) FROM voters WHERE has_voted=1").fetchone()[0]
    conn.close()
    return render_template("admin.html", voters=voters, candidates=candidates,
                           logs=logs, total_voters=total_voters, total_votes=total_votes)

@app.route("/admin/add_candidate", methods=["POST"])
def add_candidate():
    if not admin_required(): return redirect("/admin/login")
    name=request.form.get("name","").strip(); party=request.form.get("party","").strip()
    symbol=request.form.get("symbol","⭐"); color=request.form.get("color","#1a4fa0")
    manifesto=request.form.get("manifesto","")
    symbol_image=None
    f=request.files.get("symbol_image")
    if f and f.filename and allowed_file(f.filename):
        fn=secure_filename(f.filename); fn=f"{int(datetime.now().timestamp())}_{fn}"
        f.save(os.path.join(UPLOAD_FOLDER,fn)); symbol_image=fn
    conn=get_db()
    conn.execute("INSERT INTO candidates(name,party,party_symbol,party_color,symbol_image,manifesto) VALUES(?,?,?,?,?,?)",
                 (name,party,symbol,color,symbol_image,manifesto))
    conn.commit(); conn.close()
    log_action("ADMIN_ADD_CANDIDATE", details=f"Added: {name} ({party})")
    flash(f"Candidate '{name}' added"); return redirect("/admin/dashboard")

@app.route("/admin/delete_candidate/<int:cid>", methods=["POST"])
def delete_candidate(cid):
    if not admin_required(): return redirect("/admin/login")
    conn=get_db(); row=conn.execute("SELECT name FROM candidates WHERE id=?",(cid,)).fetchone()
    conn.execute("DELETE FROM candidates WHERE id=?",(cid,)); conn.commit(); conn.close()
    if row: log_action("ADMIN_DELETE_CANDIDATE", details=f"Deleted: {row['name']}")
    return redirect("/admin/dashboard")

@app.route("/admin/delete_voter/<int:vid>", methods=["POST"])
def delete_voter(vid):
    if not admin_required(): return redirect("/admin/login")
    conn=get_db(); row=conn.execute("SELECT voter_id,name FROM voters WHERE id=?",(vid,)).fetchone()
    conn.execute("DELETE FROM voters WHERE id=?",(vid,)); conn.commit(); conn.close()
    if row: log_action("ADMIN_DELETE_VOTER", row["voter_id"], f"Deleted: {row['name']}")
    return redirect("/admin/dashboard")

@app.route("/admin/update_settings", methods=["POST"])
def update_settings():
    if not admin_required(): return redirect("/admin/login")
    conn=get_db()
    for key in ("election_name","election_date"):
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",(key,request.form.get(key,"")))
    conn.commit(); conn.close(); log_action("ADMIN_UPDATE_SETTINGS"); flash("Settings saved")
    return redirect("/admin/dashboard")

@app.route("/admin/toggle_election", methods=["POST"])
def toggle_election():
    if not admin_required(): return redirect("/admin/login")
    conn=get_db(); cur=conn.execute("SELECT value FROM settings WHERE key='election_active'").fetchone()
    nv="0" if (cur and cur["value"]=="1") else "1"
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('election_active',?)",(nv,))
    conn.commit(); conn.close()
    st="ACTIVE" if nv=="1" else "PAUSED"
    log_action("ADMIN_TOGGLE_ELECTION", details=f"Election {st}"); flash(f"Election is now {st}")
    return redirect("/admin/dashboard")

@app.route("/admin/reset_election", methods=["POST"])
def reset_election():
    if not admin_required(): return redirect("/admin/login")
    conn=get_db(); conn.execute("UPDATE candidates SET vote_count=0")
    conn.execute("UPDATE voters SET has_voted=0"); conn.commit(); conn.close()
    log_action("ADMIN_RESET_ELECTION", details="All votes cleared"); flash("All votes reset")
    return redirect("/admin/dashboard")

@app.route("/admin/logout")
def admin_logout():
    log_action("ADMIN_LOGOUT", details=f"Admin '{session.get('admin_user','admin')}' logged out")
    session.pop("admin",None); session.pop("admin_user",None)
    return redirect("/admin/login")

if __name__ == "__main__":
    init_db()
    print("\n✅ EVM Voting System Running")
    print("   http://127.0.0.1:5000")
    print("   Admin: http://127.0.0.1:5000/admin/login  |  admin / admin123\n")
    app.run(debug=True)
