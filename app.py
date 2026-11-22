import argparse
import io
import json
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file

from workbook import read_workbook


ROW_FIELDS = {
    "cards": {
        "bank": "text", "card": "text", "limit": "money", "balance": "money",
        "payment": "money", "date": "date", "processed": "bool",
    },
    "expenses": {"name": "text", "amount": "money"},
    "transactions": {"description": "text", "credit": "money", "debit": "money"},
}
SCALAR_FIELDS = {
    "opening": "money", "subtotal_left": "money", "subtotal_right": "money",
    "high": "threshold", "medium": "threshold", "low": "threshold",
}
EMPTY_STATE = {
    "cards": [], "expenses": [], "transactions": [],
    "opening": None, "subtotal_left": None, "subtotal_right": None,
    "high": 7600, "medium": 5000, "low": 3000,
}


def validate_state(state):
    if not isinstance(state, dict) or state.keys() != EMPTY_STATE.keys():
        raise ValueError("Invalid ledger structure.")

    def check_fields(item, fields):
        if not isinstance(item, dict) or item.keys() != fields.keys():
            raise ValueError("Invalid ledger fields.")
        for name, kind in fields.items():
            value = item[name]
            if kind == "money":
                valid = value is None or type(value) is int and abs(value) <= 999_999_999_999
            elif kind == "threshold":
                valid = type(value) is int and 0 <= value <= 10000
            elif kind == "bool":
                valid = isinstance(value, bool)
            else:
                valid = isinstance(value, str) and len(value) <= 200
                if valid and kind == "date" and value:
                    try:
                        valid = date.fromisoformat(value).isoformat() == value
                    except ValueError:
                        valid = False
            if not valid:
                raise ValueError(f"Invalid value for {name.replace('_', ' ')}.")

    check_fields({name: state[name] for name in SCALAR_FIELDS}, SCALAR_FIELDS)
    if not 0 <= state["low"] <= state["medium"] <= state["high"]:
        raise ValueError("Thresholds must be in Low, Medium, High order.")
    for section, fields in ROW_FIELDS.items():
        rows = state[section]
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError(f"Enter up to 1,000 rows in {section}.")
        for row in rows:
            check_fields(row, fields)
            if section == "cards" and row["limit"] is not None and row["limit"] < 0:
                raise ValueError("Credit limits cannot be negative.")


def create_app(database=None):
    app = Flask(__name__)
    database = Path(database or Path(app.instance_path) / "ledger.sqlite3")
    database.parent.mkdir(parents=True, exist_ok=True)
    app.config.update(MAX_CONTENT_LENGTH=5_000_000, TRUSTED_HOSTS=["127.0.0.1", "localhost"])

    def connect():
        return sqlite3.connect(database)

    with closing(connect()) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS ledger (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            revision INTEGER NOT NULL,
            payload TEXT NOT NULL
        )""")
        db.execute("INSERT OR IGNORE INTO ledger VALUES (1, 0, ?)", (json.dumps(EMPTY_STATE),))

    def save(state, revision):
        validate_state(state)
        with closing(connect()) as db, db:
            result = db.execute(
                "UPDATE ledger SET payload = ?, revision = revision + 1 WHERE id = 1 AND revision = ?",
                (json.dumps(state), revision),
            )
            return result.rowcount == 1

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/ledger")
    def get_ledger():
        with closing(connect()) as db:
            revision, payload = db.execute("SELECT revision, payload FROM ledger WHERE id = 1").fetchone()
        response = jsonify(revision=revision, state=json.loads(payload))
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.put("/api/ledger")
    def put_ledger():
        if not request.is_json:
            abort(415)
        body = request.get_json()
        if not isinstance(body, dict) or type(body.get("revision")) is not int:
            return jsonify(error="Invalid save request."), 400
        revision = body["revision"]
        if not 0 <= revision < 2**63 - 1:
            return jsonify(error="Invalid ledger revision."), 400
        try:
            saved = save(body.get("state"), revision)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        if not saved:
            return jsonify(error="Another tab or import saved changes. Copy any unsaved values before reloading."), 409
        return jsonify(revision=revision + 1)

    @app.get("/backup")
    def backup():
        with closing(connect()) as source, closing(sqlite3.connect(":memory:")) as snapshot:
            source.backup(snapshot)
            content = io.BytesIO(snapshot.serialize())
        response = send_file(
            content, as_attachment=True, mimetype="application/vnd.sqlite3",
            download_name=f"cc-data-{date.today().isoformat()}.sqlite3",
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    return app, save


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the local credit card and cash ledger.")
    parser.add_argument("--import-xlsx", type=Path, metavar="FILE", help="Import into a new ledger and exit")
    parser.add_argument("--port", type=int, default=5000, help="Local server port (default: %(default)s)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    app, save = create_app()
    if args.import_xlsx:
        try:
            imported = save(read_workbook(args.import_xlsx), 0)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Import failed: {error}\n")
        if not imported:
            parser.exit(1, "Import requires an unused ledger. Existing entries were preserved.\n")
        print("Imported both sheets.")
    else:
        app.run(host="127.0.0.1", port=args.port)
