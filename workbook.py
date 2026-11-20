from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


def scaled_number(value, scale=100):
    if value is None or value == "":
        return None
    try:
        number = Decimal(str(value))
        if not number.is_finite():
            raise ValueError("The workbook contains a non-finite number.")
        return int((number * scale).to_integral_value(rounding=ROUND_HALF_UP))
    except InvalidOperation as error:
        raise ValueError("A workbook amount is not a number.") from error


def read_workbook(path):
    try:
        book = load_workbook(path, read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException) as error:
        raise ValueError("Choose a valid .xlsx workbook.") from error
    try:
        if not {"Sheet1", "Sheet2"}.issubset(book.sheetnames):
            raise ValueError("The workbook must contain Sheet1 and Sheet2.")
        cards, ledger = book["Sheet1"], book["Sheet2"]
        if cards["B2"].value != "Bank" or ledger["C1"].value != "Credit" or ledger["D1"].value != "Debit":
            raise ValueError("The workbook columns do not match the expected template.")
        return {
            "cards": [
                {
                    "bank": str(bank or ""), "card": str(card) if card is not None else "",
                    "limit": scaled_number(limit), "balance": scaled_number(balance),
                    "payment": scaled_number(payment), "date": iso_date(payment_date),
                    "processed": read_processed(processed),
                }
                for bank, card, limit, balance, _, _, payment, payment_date, _, _, processed
                in cards.iter_rows(min_row=3, max_row=19, min_col=2, max_col=12, values_only=True)
                if any(value is not None for value in (bank, card, limit, balance, payment, payment_date, processed))
            ],
            "expenses": [
                {"name": str(name or ""), "amount": scaled_number(amount)}
                for name, amount in cards.iter_rows(min_row=24, min_col=2, max_col=3, values_only=True)
                if name is not None or amount is not None
            ],
            "opening": scaled_number(ledger["E2"].value),
            "transactions": [
                {"description": str(name or ""), "credit": scaled_number(credit), "debit": scaled_number(debit)}
                for row, (name, credit, debit) in enumerate(
                    ledger.iter_rows(min_row=2, min_col=2, max_col=4, values_only=True), start=2
                )
                if credit is not None or debit is not None or row > 2 and name is not None
            ],
            "subtotal_left": scaled_number(ledger["L20"].value),
            "subtotal_right": scaled_number(ledger["M20"].value),
            "high": scaled_number(cards["N3"].value, 10000),
            "medium": scaled_number(cards["O3"].value, 10000),
            "low": scaled_number(cards["P3"].value, 10000),
        }
    finally:
        book.close()


def iso_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


def read_processed(value):
    return str(value).strip().casefold() in {"true", "1", "x", "yes", "y", "processed", "✓"}
