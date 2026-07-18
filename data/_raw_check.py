import sqlite3

conn = sqlite3.connect(".state/progress.db")
rows = conn.execute("SELECT stage, COUNT(*) FROM plant_progress GROUP BY stage").fetchall()
print("raw counts:", rows)
total = conn.execute("SELECT COUNT(*) FROM plant_progress").fetchone()
print("total rows:", total)
conn.close()
