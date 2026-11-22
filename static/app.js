"use strict";

const form = document.querySelector("#ledger");
const saveButton = document.querySelector("#save");
const backupButton = document.querySelector("#backup");
const status = document.querySelector("#status");
const cardTable = document.querySelector("#card-rows");
const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const rowTypes = {
  cards: {
    target: "#card-rows", noun: "card",
    columns: [
      ["bank", "Bank", "text"], ["card", "Card", "text"], ["limit", "Limit", "money"],
      ["balance", "Balance", "money"], "available", "current", ["payment", "Payment", "money"],
      ["date", "Date", "date"], "projected", "future", ["processed", "Processed", "bool"],
    ],
  },
  expenses: {
    target: "#expense-rows", noun: "expense",
    columns: [["name", "Item", "text"], ["amount", "Amount", "money"], "running"],
  },
  transactions: {
    target: "#transaction-rows", noun: "transaction",
    columns: [["description", "Description", "text"], ["credit", "Credit", "money"],
      ["debit", "Debit", "money"], "running"],
  },
};

let state;
let revision;
let editCount = 0;
let savedCount = 0;
let saving = false;
let draggedCard = null;
let dropTarget = null;

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle("error", error);
  saveButton.disabled = !state || saving || editCount === savedCount;
  backupButton.disabled = !state || saving || editCount !== savedCount;
}

function updateView() {
  const page = location.hash === "#cash" ? "cash" : "cards";
  document.querySelector("#cards").hidden = page !== "cards";
  document.querySelector("#cash").hidden = page !== "cash";
  for (const link of document.querySelectorAll("nav a")) {
    if (link.hash === "#" + page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function fillInput(input, kind, value) {
  if (kind === "bool") input.checked = value;
  else if (kind === "money" || kind === "threshold") {
    input.value = value === null ? "" : (value / 100).toFixed(2);
  } else input.value = value;
}

function makeRow(section, record, index) {
  const spec = rowTypes[section];
  const row = document.createElement("tr");
  if (section === "cards") {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.draggable = true;
    handle.textContent = "⠿";
    handle.setAttribute("aria-label", "Reorder card " + (index + 1));
    handle.setAttribute("aria-describedby", "card-order-help");
    row.insertCell().append(handle);
  }
  for (const column of spec.columns) {
    const cell = row.insertCell();
    if (typeof column === "string") {
      cell.dataset.output = column;
      cell.className = "amount";
      continue;
    }
    const [key, label, kind] = column;
    const input = document.createElement("input");
    input.setAttribute("aria-label", label + ", " + spec.noun + " " + (index + 1));
    input.type = kind === "bool" ? "checkbox" : kind === "date" ? "date" : "text";
    if (kind === "bool") cell.className = "check";
    if (kind === "money") input.inputMode = "decimal";
    if (kind === "text") input.maxLength = 200;
    input.dataset.kind = kind;
    input.dataset.field = key;
    fillInput(input, kind, record[key]);
    input.addEventListener("input", () => {
      record[key] = readInput(input);
      markEdited();
    });
    cell.append(input);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove " + spec.noun + " " + (index + 1));
  remove.addEventListener("click", () => {
    const rows = row.parentElement;
    const position = state[section].indexOf(record);
    state[section].splice(position, 1);
    row.remove();
    updateRowLabels(rows);
    (rows.rows[Math.min(position, rows.rows.length - 1)]?.querySelector("input")
      ?? document.querySelector('[data-add="' + section + '"]')).focus();
    markEdited();
  });
  row.insertCell().append(remove);
  return row;
}

function updateRowLabels(table) {
  Array.from(table.rows).forEach((row, index) => {
    for (const control of row.querySelectorAll("[aria-label]")) {
      control.setAttribute("aria-label", control.getAttribute("aria-label").replace(/\d+$/, String(index + 1)));
    }
  });
}

function moveCard(row, target, after) {
  if (row === target) return;
  const rows = Array.from(cardTable.rows);
  const from = rows.indexOf(row);
  const boundary = rows.indexOf(target) + Number(after);
  const to = from < boundary ? boundary - 1 : boundary;
  if (from === to) return;
  const [card] = state.cards.splice(from, 1);
  state.cards.splice(to, 0, card);
  if (after) target.after(row);
  else target.before(row);
  updateRowLabels(cardTable);
  row.querySelector(".drag-handle").focus();
  markEdited("Card moved to position " + (to + 1) + ". Unsaved changes");
}

function clearDropTarget() {
  dropTarget?.removeAttribute("data-drop");
  dropTarget = null;
}

function isAfterRow(event, row) {
  const rect = row.getBoundingClientRect();
  return event.clientY >= rect.top + rect.height / 2;
}

cardTable.addEventListener("dragstart", (event) => {
  if (!event.target.matches(".drag-handle")) return;
  draggedCard = event.target.closest("tr");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "card-order");
  draggedCard.classList.add("dragging");
});

cardTable.addEventListener("dragover", (event) => {
  if (!draggedCard) return;
  event.preventDefault();
  clearDropTarget();
  const row = event.target.closest("tr");
  if (!row || row === draggedCard) return;
  event.dataTransfer.dropEffect = "move";
  row.dataset.drop = isAfterRow(event, row) ? "after" : "before";
  dropTarget = row;
});

cardTable.addEventListener("dragleave", (event) => {
  if (!cardTable.contains(event.relatedTarget)) clearDropTarget();
});

cardTable.addEventListener("drop", (event) => {
  if (!draggedCard) return;
  event.preventDefault();
  const row = event.target.closest("tr");
  if (row) moveCard(draggedCard, row, isAfterRow(event, row));
  clearDropTarget();
});

cardTable.addEventListener("dragend", () => {
  draggedCard?.classList.remove("dragging");
  draggedCard = null;
  clearDropTarget();
});

cardTable.addEventListener("keydown", (event) => {
  if (!event.target.matches(".drag-handle") || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const row = event.target.closest("tr");
  const down = event.key === "ArrowDown";
  const neighbor = down ? row.nextElementSibling : row.previousElementSibling;
  if (neighbor) moveCard(row, neighbor, down);
});

function readInput(input) {
  const kind = input.dataset.kind;
  if (kind === "bool") return input.checked;
  if (kind !== "money" && kind !== "threshold") return input.value;
  input.setCustomValidity("");
  const value = input.value.trim();
  if (!value && kind === "money") return null;
  if (!/^[+-]?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) {
    input.setCustomValidity("Enter a number with up to two decimal places.");
    return null;
  }
  const cents = Math.round(Number(value) * 100);
  if (kind === "threshold" && (cents < 0 || cents > 10000)) {
    input.setCustomValidity("Enter a percentage from 0 to 100.");
    return null;
  }
  if (Math.abs(cents) > 999999999999 || (input.dataset.field === "limit" && cents < 0)) {
    input.setCustomValidity("Amount is outside the allowed range.");
    return null;
  }
  return cents;
}

function cash(cents) {
  return formatter.format(cents / 100);
}

function percent(numerator, limit) {
  return limit ? (numerator * 100 / limit).toFixed(2) + "%" : "—";
}

function color(numerator, limit) {
  if (!limit || numerator < 0 || state.high === null || state.medium === null) return "";
  const scaled = BigInt(numerator) * 10000n;
  if (scaled > BigInt(limit) * BigInt(state.high)) return "red";
  if (scaled > BigInt(limit) * BigInt(state.medium)) return "yellow";
  // Excel's Low rule and its nonnegative fallback both use the same green.
  return "green";
}

function output(selector, text) {
  document.querySelector(selector).textContent = text;
}

function cellOutput(row, field, value, tint = "") {
  const cell = row.querySelector('[data-output="' + field + '"]');
  cell.textContent = value;
  cell.dataset.color = tint;
}

function calculate() {
  const totals = { limit: 0, balance: 0, payment: 0 };
  const cardRows = document.querySelector("#card-rows").rows;
  state.cards.forEach((card, index) => {
    for (const key of Object.keys(totals)) totals[key] += card[key] ?? 0;
    const limit = card.limit ?? 0;
    const balance = card.balance ?? 0;
    const projected = balance - (card.payment ?? 0);
    const row = cardRows[index];
    cellOutput(row, "available", cash(limit - balance));
    cellOutput(row, "current", percent(balance, limit), color(balance, limit));
    cellOutput(row, "projected", cash(projected));
    cellOutput(row, "future", percent(projected, limit), color(projected, limit));
  });
  const available = totals.limit - totals.balance;
  const projected = totals.balance - totals.payment;
  const currentPercent = percent(totals.balance, totals.limit);
  const futurePercent = percent(projected, totals.limit);
  output("#total-balance", cash(totals.balance));
  output("#total-available", cash(available));
  output("#total-current", currentPercent);
  output("#total-future", futurePercent);
  const totalCells = document.querySelector("#card-totals").rows[0].cells;
  const values = ["", "Totals", "", cash(totals.limit), cash(totals.balance), cash(available),
    currentPercent, cash(totals.payment), "", cash(projected), futurePercent, "", ""];
  values.forEach((value, index) => { totalCells[index].textContent = value; });

  let running = totals.payment;
  output("#expense-seed td:nth-child(2)", cash(running));
  output("#expense-seed td:nth-child(3)", cash(running));
  const expenseRows = document.querySelector("#expense-rows").rows;
  state.expenses.forEach((entry, index) => {
    running += entry.amount ?? 0;
    cellOutput(expenseRows[index], "running", cash(running));
  });

  let ending = state.opening ?? 0;
  let credits = 0;
  let debits = 0;
  const transactionRows = document.querySelector("#transaction-rows").rows;
  state.transactions.forEach((entry, index) => {
    const credit = entry.credit ?? 0;
    const debit = entry.debit ?? 0;
    credits += credit;
    debits += debit;
    ending += credit - debit;
    cellOutput(transactionRows[index], "running", cash(ending), ending < 0 ? "negative" : "");
  });
  output("#credit-total", cash(credits));
  output("#debit-total", cash(debits));
  output("#ending", cash(ending));
  document.querySelector("#ending").classList.toggle("negative-balance", ending < 0);
  document.querySelector("#empty-ledger").hidden = state.transactions.length > 0;
  output("#subtotal", cash((state.subtotal_left ?? 0) + (state.subtotal_right ?? 0)));
}

function markEdited(text = "Unsaved changes") {
  editCount += 1;
  calculate();
  message(saving ? "Saving…" : text);
}

for (const button of document.querySelectorAll("[data-add]")) {
  button.addEventListener("click", () => {
    const section = button.dataset.add;
    const spec = rowTypes[section];
    if (state[section].length >= 1000) {
      message("This table holds up to 1,000 rows.", true);
      return;
    }
    const record = {};
    for (const column of spec.columns.filter(Array.isArray)) {
      const [key, , kind] = column;
      record[key] = { money: null, bool: false, text: "", date: "" }[kind];
    }
    state[section].push(record);
    const row = makeRow(section, record, state[section].length - 1);
    document.querySelector(spec.target).append(row);
    row.querySelector("input").focus();
    markEdited();
  });
}

for (const input of form.querySelectorAll("[data-scalar]")) {
  input.addEventListener("input", () => {
    state[input.dataset.scalar] = readInput(input);
    markEdited();
  });
}

form.noValidate = true;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveButton.disabled) return;
  const invalid = form.querySelector("input:invalid");
  if (invalid) {
    history.replaceState(null, "", invalid.closest("#cash") ? "#cash" : "#cards");
    updateView();
    const details = invalid.closest("details");
    if (details) details.open = true;
    invalid.reportValidity();
    return;
  }
  const submitted = editCount;
  saving = true;
  message("Saving…");
  let resultMessage = "";
  let failed = false;
  try {
    const response = await fetch("/api/ledger", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision, state }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save changes.");
    revision = result.revision;
    savedCount = submitted;
    resultMessage = editCount === savedCount ? "Changes saved" : "Unsaved changes";
  } catch (error) {
    failed = true;
    resultMessage = error.message || "Could not save changes.";
  } finally {
    saving = false;
    message(resultMessage, failed);
  }
});

backupButton.addEventListener("click", () => { window.location.href = "/backup"; });
window.addEventListener("hashchange", updateView);
window.addEventListener("beforeunload", (event) => {
  if (editCount !== savedCount) {
    event.preventDefault();
    event.returnValue = "";
  }
});

async function loadLedger() {
  updateView();
  try {
    const response = await fetch("/api/ledger");
    if (!response.ok) throw new Error("Could not load the ledger. Reload to retry.");
    ({ state, revision } = await response.json());
    for (const [section, spec] of Object.entries(rowTypes)) {
      const table = document.querySelector(spec.target);
      state[section].forEach((record, index) => table.append(makeRow(section, record, index)));
    }
    for (const input of form.querySelectorAll("[data-scalar]")) {
      fillInput(input, input.dataset.kind, state[input.dataset.scalar]);
    }
    const totals = document.querySelector("#card-totals").insertRow();
    for (let column = 0; column < 13; column += 1) totals.insertCell();
    const payments = document.querySelector("#expense-seed").insertRow();
    payments.insertCell().textContent = "Payments";
    for (let column = 1; column < 4; column += 1) payments.insertCell();
    calculate();
    form.hidden = false;
    message("");
  } catch (error) {
    state = null;
    message(error.message || "Could not load the ledger.", true);
  }
}

loadLedger();
