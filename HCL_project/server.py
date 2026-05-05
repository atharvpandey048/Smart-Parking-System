from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sock import Sock
import sqlite3
import json
import os

app = Flask(__name__)
CORS(app)
sock = Sock(app)

DB_FILE = "smartpark.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Create Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                phone TEXT,
                role TEXT DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
              )''')
    
    # Create Bookings table
    c.execute('''CREATE TABLE IF NOT EXISTS bookings (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                loc_id TEXT,
                slot_id INTEGER,
                loc_name TEXT,
                duration INTEGER,
                price REAL,
                total_price REAL,
                vehicle_no TEXT,
                vehicle_type TEXT,
                start_time INTEGER,
                expired BOOLEAN DEFAULT 0,
                cancelled BOOLEAN DEFAULT 0,
                refund_status TEXT,
                checked_in BOOLEAN DEFAULT 0,
                checked_out BOOLEAN DEFAULT 0
              )''')
    
    # Create Admin account if it doesn't exist
    c.execute("SELECT * FROM users WHERE email='admin@admin.com'")
    if not c.fetchone():
        c.execute("INSERT INTO users (name, email, password, role) VALUES ('System Administrator', 'admin@admin.com', 'admin', 'admin')")
        
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# WebSocket clients
connected_clients = set()

@sock.route('/ws')
def sync_handler(ws):
    connected_clients.add(ws)
    try:
        while True:
            message = ws.receive()
            if message:
                # Broadcast to other clients
                for client in connected_clients:
                    if client != ws:
                        try:
                            client.send(message)
                        except:
                            pass
    except:
        pass
    finally:
        connected_clients.remove(ws)

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')
    
    if not name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400
        
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", (name, email, password))
        user_id = c.lastrowid
        conn.commit()
        
        # Pull new user to return back
        c.execute("SELECT id, name, email, role, created_at FROM users WHERE id=?", (user_id,))
        user = dict(c.fetchone())
        conn.close()
        
        return jsonify({"user": user, "token": "mock-token-" + str(user_id)})
    except sqlite3.IntegrityError:
        return jsonify({"error": "User already exists"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id, name, email, role, phone, created_at FROM users WHERE email=? AND password=?", (email, password))
    row = c.fetchone()
    conn.close()
    
    if row:
        user = dict(row)
        if user['role'] == 'admin':
            return jsonify({"error": "Administrators must log in via the Secure Admin Portal."}), 401
        return jsonify({"user": user, "token": "mock-token-" + str(user['id'])})
    else:
        return jsonify({"error": "Invalid email or password"}), 401

@app.route('/api/admin-login', methods=['POST'])
def admin_login():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id, name, email, role, phone, created_at FROM users WHERE email=? AND password=?", (email, password))
    row = c.fetchone()
    conn.close()
    
    if row:
        user = dict(row)
        if user['role'] != 'admin':
            return jsonify({"error": "Unauthorized. Standard users cannot access Admin portal."}), 401
        return jsonify({"user": user, "token": "mock-token-admin-" + str(user['id'])})
    else:
        return jsonify({"error": "Invalid admin credentials"}), 401

@app.route('/api/profile/update', methods=['POST'])
def update_profile():
    data = request.json
    user_id = data.get('userId')
    name = data.get('name')
    phone = data.get('phone')
    password = data.get('password')
    
    conn = get_db_connection()
    c = conn.cursor()
    
    updates = []
    params = []
    if name:
        updates.append("name=?")
        params.append(name)
    if phone is not None:
        updates.append("phone=?")
        params.append(phone)
    if password:
        updates.append("password=?")
        params.append(password)
        
    if not updates:
        return jsonify({"error": "No updates provided"}), 400
        
    params.append(user_id)
    c.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", params)
    conn.commit()
    
    c.execute("SELECT id, name, email, role, phone, created_at FROM users WHERE id=?", (user_id,))
    user = dict(c.fetchone())
    conn.close()
    
    return jsonify({"user": user})

if __name__ == '__main__':
    init_db()
    # We run on 8080 to match previous websocket port, but now it's HTTP + WS
    app.run(host='0.0.0.0', port=8080)
