# CC Data

A local credit card, expense, and cash ledger built with Flask, plain HTML/CSS/JavaScript, and SQLite. The browser calculates totals and colors as you edit. **Save changes** writes both views to the local database.

## Start on Windows

Install Python 3.11 or later. Open PowerShell in the project directory and run:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

Open [the local app](http://127.0.0.1:5000) in Edge. Keep PowerShell open while using it. Press Ctrl+C to stop the app. On macOS or Linux use `python3 -m venv .venv` and `.venv/bin/python` for the same commands.

## Import the workbook

Before saving edits in the app, run the import once with your workbook path:

```powershell
.\.venv\Scripts\python.exe app.py --import-xlsx "C:\path\to\CC Data.xlsx"
```

The import reads the existing Sheet1 and Sheet2 layouts and rejects imports once the ledger has been saved or imported. Sheet1’s Rent and Util rows stay in the payment grid so they can be included in the payment total. Planned payments feed the running expense total. Each Sheet2 transaction displays its resulting balance on the same row. The separate pair of amounts in Sheet2 has its own subtotal.

A blank or zero limit displays a dash for utilization. The default workbook rules display red above 76%, yellow above 50%, and green for nonnegative utilization through 50%. The workbook's Low threshold uses the same green as its nonnegative fallback.

## Save, back up, and restore

Use **Save changes** when you finish editing either view. **Download backup** exports a SQLite snapshot of your saved data. To restore a backup, stop the app, keep a copy of the current database, and place the backup at `instance/ledger.sqlite3`. Restart the app and reload the browser.

Drag a card by its handle to reorder the list, or focus the handle and press Up or Down. Save changes to keep the new order.

Keep the workbook, database, and backups on your computer. The server listens on your own computer at `127.0.0.1`.
