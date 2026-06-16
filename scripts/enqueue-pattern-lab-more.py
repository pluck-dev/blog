#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, re, sqlite3, uuid
from pathlib import Path

DB = Path('data/admin.db')
SRC = 'drivingplus.me'
DST = 'pattern-lab.local'

def source_id_from_test_slot(slot_id: str) -> str | None:
    m = re.search(r'((?:DT|NW)_[A-Z0-9]+_[0-9a-f]{12})$', slot_id)
    return m.group(1) if m else None

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=100)
    ap.add_argument('--cooldown-sec', type=int, default=5)
    args = ap.parse_args()
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute('pragma foreign_keys=on')
    if not con.execute('select 1 from tenants where domain=?', (DST,)).fetchone():
        raise SystemExit(f'tenant not found: {DST}')
    existing_source = set()
    for r in con.execute('select slot_id from slots where tenant=?', (DST,)):
        src = source_id_from_test_slot(r['slot_id'])
        if src:
            existing_source.add(src)
    candidates = [r for r in con.execute('''select * from slots
        where tenant=? and status='planned' and region is not null and trim(region)!=''
        order by priority_score desc, created_at asc, slot_id asc''', (SRC,)) if r['slot_id'] not in existing_source]
    groups: dict[str, list[sqlite3.Row]] = {}
    for r in candidates:
        groups.setdefault(r['template_id'], []).append(r)
    order = sorted(groups, key=lambda t: (-len(groups[t]), t))
    picked: list[sqlite3.Row] = []
    while len(picked) < args.limit and order:
        for template in list(order):
            bucket = groups[template]
            if bucket:
                picked.append(bucket.pop(0))
                if len(picked) >= args.limit:
                    break
            if not bucket and template in order:
                order.remove(template)
    batch_tag = 'PLM' + uuid.uuid4().hex[:6].upper()
    slot_ids: list[str] = []
    for slot in picked:
        new_id = f'{batch_tag}_{slot["slot_id"]}'
        con.execute('''insert into slots
            (slot_id, tenant, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score, status, last_error)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', null)''',
            (new_id, DST, slot['template_id'], slot['primary_keyword'], slot['region'], slot['persona'], slot['intent'], slot['modifier_1'], slot['modifier_2'], slot['entity_id'], slot['priority_score']))
        slot_ids.append(new_id)
    job_id = None
    if slot_ids:
        job_id = str(uuid.uuid4())
        payload = {
            'slot_ids': slot_ids,
            'provider': 'codex',
            'model': '',
            'design_template_id': 'comparison',
            'cooldown_sec': args.cooldown_sec,
            'timeout_sec': 900,
            'max_repair_attempts': 3,
            'pattern_based': True,
        }
        con.execute('insert into jobs (id, tenant, kind, payload, status) values (?, ?, "generate", ?, "queued")', (job_id, DST, json.dumps(payload, ensure_ascii=False)))
    con.commit()
    print(json.dumps({'tenant': DST, 'batch_tag': batch_tag, 'created_slots': len(slot_ids), 'queued_job_id': job_id, 'slot_ids': slot_ids}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
