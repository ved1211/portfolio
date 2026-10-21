"""
Simulate 24 months of purchasing for a fictional German manufacturer of
electronic control units (ECUs).

SIMULATED DATA. The company, its plants, suppliers and materials are invented.
Nothing here comes from Greenox or any other real company.

The output looks like an extract from an ERP system, split into a star schema:

  data/DimSupplier.csv       one row per supplier
  data/DimMaterial.csv       one row per purchased material
  data/DimPlant.csv          the two plants
  data/DimDate.csv           one row per calendar day
  data/FactPOLine.csv        one row per purchase order line (what was ordered)
  data/FactGoodsReceipt.csv  one row per goods receipt (what arrived)

Patterns built in on purpose, plain rather than dramatic:
  * Two suppliers whose on-time delivery gets worse month by month.
  * Semiconductors ordered in 2025 Q2 come with much longer lead times
    and a price premium, like an allocation shortage.
  * One critical microcontroller is single-sourced and is the largest
    single line of spend.
  * Spend is concentrated: a handful of suppliers carry most of it.
  * One supplier in the highest risk tier has an overdue sustainability
    risk assessment.

Country risk tiers are invented for this exercise. They describe logistics
exposure only (Low: delivered by truck within Europe, Medium: transatlantic,
High: Asian sea freight) and are not an assessment of any country.

Run:  python analysis/simulate.py   (from projects/supplier-performance)
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np

SEED = 20240101
START, END = date(2024, 1, 1), date(2025, 12, 31)   # order window and data cut-off
DATE_TABLE_END = date(2026, 6, 30)                  # promised dates run past the cut-off

PLANTS = [("P1", "Plant Augsburg", "Augsburg", "Germany"), ("P2", "Plant Chemnitz", "Chemnitz", "Germany")]

COUNTRIES = {  # code: (name, invented logistics risk tier, legal form)
    "DE": ("Germany", "Low", "GmbH"), "AT": ("Austria", "Low", "GmbH"),
    "NL": ("Netherlands", "Low", "B.V."), "IT": ("Italy", "Low", "S.r.l."),
    "CZ": ("Czech Republic", "Low", "s.r.o."), "PL": ("Poland", "Low", "Sp. z o.o."),
    "HU": ("Hungary", "Low", "Kft."), "US": ("United States", "Medium", "Inc."),
    "TW": ("Taiwan", "High", "Co., Ltd."), "MY": ("Malaysia", "High", "Sdn. Bhd."),
    "CN": ("China", "High", "Co., Ltd."),
}

CATEGORIES = {
    # suppliers' countries, monthly budget in EUR, number of materials, orders per material-month
    "Semiconductors":     (["TW", "TW", "MY", "CN", "US", "US", "DE", "NL"], 3_300_000, 60, 1.00),
    "PCBs":               (["CN", "CN", "TW", "DE", "AT", "CZ", "PL"],      1_650_000, 35, 1.10),
    "Housings":           (["DE", "DE", "DE", "CZ", "CZ", "PL", "PL", "IT"], 1_250_000, 40, 0.90),
    "Connectors":         (["DE", "DE", "DE", "CZ", "HU", "US", "CN"],      1_000_000, 50, 0.80),
    "Passive components": (["CN", "CN", "TW", "MY", "DE", "DE", "AT", "HU"],  650_000, 70, 0.60),
    "Packaging":          (["DE", "DE", "DE", "PL", "PL", "CZ", "NL"],        400_000, 45, 0.70),
}
SUPPLIER_WORD = {"Semiconductors": "Semiconductor", "PCBs": "Circuits", "Housings": "Metalworks",
                 "Connectors": "Connect", "Passive components": "Electronics", "Packaging": "Packaging"}

MATERIAL_TYPES = {
    "Semiconductors": [("MCU 32-bit", 2.5, 9.0), ("Power management IC", 1.2, 4.5), ("CAN transceiver", 0.4, 1.2),
                       ("Gate driver", 0.8, 3.0), ("MOSFET", 0.15, 0.9), ("Voltage regulator", 0.2, 1.1),
                       ("Op-amp", 0.15, 0.7), ("EEPROM", 0.1, 0.6), ("Sensor IC", 0.9, 3.5), ("LIN transceiver", 0.3, 0.9)],
    "PCBs": [("PCB 4-layer control board", 3.0, 9.0), ("PCB 6-layer main board", 8.0, 22.0), ("Flex PCB", 1.5, 6.0),
             ("PCB 2-layer sensor board", 1.0, 3.5)],
    "Housings": [("Die-cast aluminium housing", 6.0, 18.0), ("Plastic cover", 0.6, 2.5), ("Heat sink", 1.5, 6.0),
                 ("Seal gasket", 0.2, 0.9), ("Mounting bracket", 0.4, 1.8)],
    "Connectors": [("Automotive connector 48-pin", 1.8, 5.5), ("Automotive connector 24-pin", 0.9, 2.8),
                   ("Board header", 0.15, 0.8), ("Crimp terminal", 0.02, 0.09), ("Sealed plug", 0.3, 1.2)],
    "Passive components": [("MLCC capacitor", 0.002, 0.03), ("Chip resistor", 0.001, 0.01), ("Power inductor", 0.05, 0.4),
                           ("Electrolytic capacitor", 0.04, 0.3), ("Ferrite bead", 0.005, 0.03), ("Crystal oscillator", 0.15, 0.6)],
    "Packaging": [("ESD tray", 0.6, 2.4), ("Shipping carton", 0.3, 1.5), ("Foam insert", 0.2, 0.9),
                  ("Label roll", 4.0, 12.0), ("Returnable plastic crate", 3.0, 9.0)],
}
PACK = {"Semiconductors": 500, "PCBs": 100, "Housings": 50, "Connectors": 500, "Passive components": 10_000, "Packaging": 100}

# Promised lead time in days by category and risk tier: (mean, spread)
LEAD = {
    "Semiconductors": {"Low": (56, 10), "Medium": (70, 12), "High": (84, 14)},
    "PCBs": {"Low": (28, 5), "Medium": (35, 6), "High": (42, 7)},
    "Housings": {"Low": (21, 5), "Medium": (28, 5), "High": (35, 6)},
    "Connectors": {"Low": (21, 5), "Medium": (35, 7), "High": (49, 7)},
    "Passive components": {"Low": (28, 7), "Medium": (42, 7), "High": (56, 10)},
    "Packaging": {"Low": (10, 3), "Medium": (14, 3), "High": (21, 4)},
}

SYLL_A = ["Ar", "Bel", "Cor", "Dal", "Ev", "Fen", "Gal", "Hal", "Ist", "Jor", "Kel", "Lun", "Mor", "Nev",
          "Ost", "Pra", "Ros", "Sel", "Tor", "Ul", "Ver", "Wen", "Zen", "Bran", "Cal", "Dor", "Mira", "Tal"]
SYLL_B = ["vex", "dra", "mont", "lix", "tek", "nor", "vane", "ric", "mar", "sen", "lon", "dex", "ven", "tra"]


@dataclass
class Supplier:
    id: str
    name: str
    country: str
    category: str
    iso9001: bool
    iso14001: bool
    size: float
    on_time: float           # chance a delivery arrives by the promised date
    reject_rate: float       # share of received units rejected at incoming inspection
    markup: float            # how far its prices sit above standard
    worsening: bool = False
    dd_status: str = "Done"
    last_assessment: date | None = None
    single_source: bool = False


@dataclass
class Material:
    id: str
    name: str
    category: str
    std_price: float
    monthly_spend: float
    critical: bool
    sources: list = field(default_factory=list)      # (supplier, share)
    plants: tuple = ("P1", "P2")


def workday(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def month_starts():
    m = date(START.year, START.month, 1)
    while m <= END:
        yield m
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)


def main() -> None:
    rng = np.random.default_rng(SEED)
    pick = lambda options, p=None: options[int(rng.choice(len(options), p=p))]

    # ── suppliers ──────────────────────────────────────────────────────────
    suppliers: list[Supplier] = []
    used = set()
    n = 1
    for cat, (countries, *_rest) in CATEGORIES.items():
        for cc in countries:
            while True:
                stem = pick(SYLL_A) + pick(SYLL_B)
                if stem not in used:
                    used.add(stem)
                    break
            legal = COUNTRIES[cc][2]
            suppliers.append(Supplier(
                id=f"S{n:03d}", name=f"{stem} {SUPPLIER_WORD[cat]} {legal}", country=cc, category=cat,
                iso9001=bool(rng.random() < (0.85 if cat == "Packaging" else 0.97)),
                iso14001=bool(rng.random() < 0.6),
                size=float(np.exp(rng.normal(0, 0.9))),
                on_time=float(np.clip(rng.beta(30, 2), 0.86, 0.99)),
                reject_rate=float(np.clip(np.exp(rng.normal(np.log(0.003), 0.7)), 0.0003, 0.02)),
                markup=float(rng.normal(0.004, 0.012)),
            ))
            n += 1
    by_cat = {c: [s for s in suppliers if s.category == c] for c in CATEGORIES}

    # The built-in story lines.
    mcu_supplier = by_cat["Semiconductors"][0]                 # Taiwan: sole source of the key MCU
    mcu_supplier.size = max(mcu_supplier.size, 3.0)
    worse = [by_cat["PCBs"][5], by_cat["Connectors"][4]]      # Czech PCB maker, Hungarian connector maker
    for s in worse:
        s.worsening, s.on_time, s.size = True, 0.99, max(s.size, 3.0)
    risky = by_cat["PCBs"][0]                                  # Chinese PCB maker: High tier, assessment overdue
    risky.size = max(risky.size, 2.8)
    by_cat["Housings"][3].reject_rate = 0.022                  # one supplier with poor incoming quality

    # Sustainability due diligence status, tracked the way LkSG-style programmes do.
    for s in suppliers:
        s.dd_status = pick(["Done", "Open", "Overdue"], [0.72, 0.2, 0.08])
        if COUNTRIES[s.country][1] == "High" and s.dd_status == "Overdue":
            s.dd_status = "Open"           # only one high-tier supplier is overdue, by design
    risky.dd_status = "Overdue"
    for s in suppliers:
        if s.dd_status == "Done":
            s.last_assessment = END - timedelta(days=int(rng.integers(20, 330)))
        elif s.dd_status == "Overdue":
            s.last_assessment = END - timedelta(days=int(rng.integers(420, 700)))

    # ── materials and who may supply them ──────────────────────────────────
    materials: list[Material] = []
    m_id = 10001
    for cat, (_countries, budget, count, _rate) in CATEGORIES.items():
        shares = rng.dirichlet(np.full(count, 0.7))
        types = MATERIAL_TYPES[cat]
        for i in range(count):
            label, lo, hi = types[i % len(types)]
            price = float(np.exp(rng.uniform(np.log(lo), np.log(hi))))
            variant = f"{chr(65 + (i // len(types)) % 26)}{int(rng.integers(10, 99))}"
            materials.append(Material(f"M{m_id}", f"{label}, type {variant}", cat,
                                      round(price, 4), float(budget * shares[i]), critical=False))
            m_id += 1
    cat_mats = {c: [m for m in materials if m.category == c] for c in CATEGORIES}

    # The critical microcontroller: the largest single spend line, one source only.
    mcu = cat_mats["Semiconductors"][0]
    mcu.name, mcu.std_price, mcu.monthly_spend, mcu.critical = "MCU 32-bit automotive, 2 MB flash", 6.8, 420_000.0, True
    for m in cat_mats["Semiconductors"][1:4] + cat_mats["PCBs"][1:3]:
        m.critical = True

    for m in materials:
        pool = by_cat[m.category]
        if m is mcu:
            m.sources = [(mcu_supplier, 1.0)]
        else:
            single_p = {"Semiconductors": 0.22, "PCBs": 0.14}.get(m.category, 0.05)
            k = 1 if rng.random() < single_p else (2 if rng.random() < 0.68 else 3)
            weights = np.array([s.size ** 2 for s in pool])
            chosen = rng.choice(len(pool), size=k, replace=False, p=weights / weights.sum())
            split = {1: [1.0], 2: [0.7, 0.3], 3: [0.6, 0.25, 0.15]}[k]
            m.sources = [(pool[int(j)], split[r]) for r, j in enumerate(chosen)]
        r = rng.random()
        m.plants = ("P1", "P2") if r < 0.65 else (("P1",) if r < 0.85 else ("P2",))
    # Every supplier on the list gets real orders: a small supplier is given a
    # minor share of materials that already have more than one source, until it
    # can expect at least eight orders over the two years.
    months = 24
    for s in suppliers:
        expected = lambda: sum(CATEGORIES[m.category][3] * months * share
                               for m in cat_mats[s.category] for sup, share in m.sources if sup is s)
        candidates = [m for m in cat_mats[s.category]
                      if 1 < len(m.sources) < 3 and m is not mcu and all(sup is not s for sup, _ in m.sources)]
        while expected() < 8 and candidates:
            m = candidates.pop(0)
            m.sources = [(sup, share * 0.75) for sup, share in m.sources] + [(s, 0.25)]
    for m in materials:
        if len(m.sources) == 1:
            m.sources[0][0].single_source = True

    # ── purchase order lines and goods receipts ────────────────────────────
    po_lines, receipts = [], []
    line_no, receipt_no, po_no = 1, 1, 4500000001
    po_of = {}  # (supplier, order date) -> PO number
    for month_index, m0 in enumerate(month_starts()):
        season = {8: 0.7, 12: 0.8}.get(m0.month, 1.0)
        growth = 1.0 if m0.year == 2024 else 1.04
        q2_2025 = m0.year == 2025 and 4 <= m0.month <= 6
        days_in_month = (date(m0.year + (m0.month == 12), m0.month % 12 + 1, 1) - m0).days
        for m in materials:
            rate = CATEGORIES[m.category][3]
            # Buyers call off on a rhythm: whole orders every month, plus a chance of one more.
            orders = int(rate) + (1 if rng.random() < rate - int(rate) else 0)
            for _ in range(orders):
                sup = m.sources[int(rng.choice(len(m.sources), p=[s for _, s in m.sources]))][0]
                order_date = workday(m0 + timedelta(days=int(rng.integers(0, days_in_month - 2))))
                if order_date > END:
                    continue
                plant = m.plants[0] if len(m.plants) == 1 else ("P1" if rng.random() < 0.6 else "P2")
                std = m.std_price * (1.0 if m0.year == 2024 else 1.02)
                spot = q2_2025 and m.category == "Semiconductors"
                paid = std * (1 + sup.markup + rng.normal(0, 0.012) + (rng.normal(0.07, 0.025) if spot else 0))
                pack = PACK[m.category]
                qty = m.monthly_spend * season * growth / rate / std * float(np.exp(rng.normal(0, 0.25)))
                qty = max(pack, int(np.ceil(qty / pack)) * pack)

                tier = COUNTRIES[sup.country][1]
                mean, spread = LEAD[m.category][tier]
                lt = max(5, rng.normal(mean, spread)) * (1.6 if spot else 1.0)
                promised = workday(order_date + timedelta(days=int(round(lt))))

                # Did it arrive on time? Two suppliers slip a little more every month.
                p_on = sup.on_time - (0.60 * month_index / 23 if sup.worsening else 0.0)
                if rng.random() < p_on:
                    arrive = promised - timedelta(days=int(rng.integers(0, 5)))
                else:
                    late = np.exp(rng.normal(np.log(4), 0.7)) * (1 + (month_index / 12 if sup.worsening else 0))
                    arrive = promised + timedelta(days=int(np.ceil(late)))
                if spot:
                    arrive += timedelta(days=int(max(0, rng.normal(10, 6))))
                arrive = workday(max(arrive, order_date + timedelta(days=3)))

                key = (sup.id, order_date)
                if key not in po_of:
                    po_of[key] = po_no
                    po_no += 1
                po_lines.append({
                    "POLineID": f"L{line_no:05d}", "PONumber": str(po_of[key]), "OrderDate": order_date,
                    "PromisedDate": promised, "SupplierID": sup.id, "MaterialID": m.id, "PlantID": plant,
                    "OrderedQty": qty, "StandardUnitPriceEUR": round(std, 4), "PaidUnitPriceEUR": round(paid, 4),
                    "NetValueEUR": round(qty * paid, 2), "StandardValueEUR": round(qty * std, 2),
                })

                # Deliveries: most arrive complete, some in two parts, a few short.
                r = rng.random()
                if r < 0.10:
                    first = int(qty * rng.uniform(0.5, 0.8) // pack * pack) or pack
                    parts = [(arrive, first), (workday(arrive + timedelta(days=int(rng.integers(4, 22)))), qty - first)]
                elif r < 0.13:
                    parts = [(arrive, int(qty * rng.uniform(0.9, 0.99)))]
                else:
                    parts = [(arrive, qty)]
                for when, received in parts:
                    if when > END or received <= 0:
                        continue   # not arrived by the data cut-off
                    rejected = int(rng.binomial(received, sup.reject_rate))
                    receipts.append({"ReceiptID": f"G{receipt_no:06d}", "POLineID": f"L{line_no:05d}",
                                     "ReceiptDate": when, "ReceivedQty": received, "RejectedQty": rejected})
                    receipt_no += 1
                line_no += 1

    # ── write the star schema ──────────────────────────────────────────────
    out = Path(__file__).resolve().parent.parent / "data"
    out.mkdir(parents=True, exist_ok=True)

    def write(name: str, rows: list[dict]) -> None:
        with open(out / f"{name}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            for row in rows:
                w.writerow({k: (v.isoformat() if isinstance(v, date) else ("Yes" if v is True else "No" if v is False else v))
                            for k, v in row.items()})

    write("DimSupplier", [{
        "SupplierID": s.id, "SupplierName": s.name, "Country": COUNTRIES[s.country][0], "CountryCode": s.country,
        "Category": s.category, "ISO9001": s.iso9001, "ISO14001": s.iso14001, "SingleSource": s.single_source,
        "CountryRiskTier": COUNTRIES[s.country][1], "DueDiligenceStatus": s.dd_status,
        "LastAssessmentDate": s.last_assessment.isoformat() if s.last_assessment else "",
    } for s in suppliers])
    write("DimMaterial", [{
        "MaterialID": m.id, "MaterialName": m.name, "Category": m.category, "Critical": m.critical,
        "SingleSource": len(m.sources) == 1, "ApprovedSuppliers": len(m.sources),
        "StandardPriceEUR": round(m.std_price * 1.02, 4),
    } for m in materials])
    write("DimPlant", [{"PlantID": p, "PlantName": n_, "City": c, "Country": k} for p, n_, c, k in PLANTS])
    dates, d = [], START
    while d <= DATE_TABLE_END:
        iso = d.isocalendar()
        q = (d.month - 1) // 3 + 1
        dates.append({"Date": d, "Year": d.year, "Quarter": f"Q{q}", "YearQuarter": f"{d.year} Q{q}",
                      "YearQuarterSort": d.year * 10 + q, "MonthNumber": d.month, "MonthName": d.strftime("%b"),
                      "YearMonth": d.strftime("%Y-%m"), "YearMonthSort": d.year * 100 + d.month,
                      "MonthStart": d.replace(day=1), "ISOWeek": iso[1], "IsWorkday": d.weekday() < 5})
        d += timedelta(days=1)
    write("DimDate", dates)
    write("FactPOLine", po_lines)
    write("FactGoodsReceipt", receipts)

    spend = sum(p["NetValueEUR"] for p in po_lines)
    print(f"{len(suppliers)} suppliers, {len(materials)} materials, {len(po_lines)} PO lines, "
          f"{len(receipts)} receipts, spend EUR {spend / 1e6:.1f}M")


if __name__ == "__main__":
    main()
