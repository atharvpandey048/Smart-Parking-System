import sqlite3
import os

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
    
    # Create Bookings table if we want to persist bookings too
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

if __name__ == "__main__":
    init_db()
    print("Database initialized.")
