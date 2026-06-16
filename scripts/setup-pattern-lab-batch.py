#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sqlite3, uuid
from pathlib import Path

DB = Path('data/admin.db')
SRC = 'drivingplus.me'
DST = 'pattern-lab.local'
DISPLAY = '패턴랩 운전면허'


def ensure_tenant_and_facts(con: sqlite3.Connection) -> None:
    src_tenant = con.execute('select * from tenants where domain=?', (SRC,)).fetchone()
    if not src_tenant:
        raise SystemExit(f'source tenant not found: {SRC}')
    con.execute('''insert or ignore into tenants
        (domain, display_name, vertical, theme, brand_color, templates_enabled, design_template_id, content_brief, daily_limit)
        values (?, ?, 'driving', 'clean', '#2563eb', ?, 'comparison', ?, 50)''',
        (DST, DISPLAY, src_tenant['templates_enabled'], '원본 전체 글 패턴 기반 양산 테스트 도메인. 운영 도메인과 분리한다.'))
    con.execute('update tenants set display_name=?, vertical="driving", design_template_id="comparison", daily_limit=50, content_brief=? where domain=?',
                (DISPLAY, '원본 전체 글 패턴 기반 양산 테스트 도메인. 운영 도메인과 분리한다.', DST))

    con.execute('delete from axes where tenant=?', (DST,))
    con.execute('''insert into axes (tenant, axis, value, weight, monthly_search_volume, competition_kd)
                   select ?, axis, value, weight, monthly_search_volume, competition_kd from axes where tenant=?''', (DST, SRC))
    con.execute('delete from seo_regions where tenant=?', (DST,))
    con.execute('''insert into seo_regions (tenant, level, region, latitude, longitude, source_name, synced_at)
                   select ?, level, region, latitude, longitude, source_name, synced_at from seo_regions where tenant=?''', (DST, SRC))
    # Refresh facts only if empty or explicitly stale is not needed; delete/reinsert keeps test facts identical to source.
    con.execute('delete from academies where tenant=?', (DST,))
    cols = [r['name'] for r in con.execute('pragma table_info(academies)')]
    insert_cols = ', '.join(cols)
    placeholders = ', '.join(['?'] * len(cols))
    for row in con.execute('select * from academies where tenant=?', (SRC,)):
        vals = []
        for col in cols:
            if col == 'id': vals.append(str(uuid.uuid4()))
            elif col == 'tenant': vals.append(DST)
            else: vals.append(row[col])
        con.execute(f'insert into academies ({insert_cols}) values ({placeholders})', vals)


def pick_source_slots(con: sqlite3.Connection, limit: int) -> list[sqlite3.Row]:
    existing_src_ids = set()
    for r in con.execute('select slot_id from slots where tenant=?', (DST,)):
        sid = r['slot_id']
        if sid.startswith('PLB_'):
            existing_src_ids.add('DT_' + sid[4:].split('_', 1)[1] if sid.startswith('PLB_DT_') else sid.removeprefix('PLB_'))
        elif sid.startswith('PL_'):
            existing_src_ids.add(sid.removeprefix('PL_'))
    rows = [r for r in con.execute('''select * from slots
        where tenant=? and status='planned' and region is not null and trim(region)!=''
        order by priority_score desc, created_at asc, slot_id asc''', (SRC,))]
    rows = [r for r in rows if r['slot_id'] not in existing_src_ids]
    groups: dict[str, list[sqlite3.Row]] = {}
    for r in rows:
        groups.setdefault(r['template_id'], []).append(r)
    order = sorted(groups, key=lambda t: (-len(groups[t]), t))
    picked: list[sqlite3.Row] = []
    while len(picked) < limit and order:
        progressed = False
        for template in list(order):
            bucket = groups[template]
            if bucket:
                picked.append(bucket.pop(0)); progressed = True
                if len(picked) >= limit: break
            if not bucket:
                order.remove(template)
        if not progressed: break
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=50)
    ap.add_argument('--cooldown-sec', type=int, default=5)
    args = ap.parse_args()
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute('pragma foreign_keys=on')
    ensure_tenant_and_facts(con)
    rows = pick_source_slots(con, max(1, args.limit))
    created: list[str] = []
    for slot in rows:
        new_id = 'PLB_' + slot['slot_id']
        con.execute('''insert into slots
            (slot_id, tenant, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score, status, last_error)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', null)
            on conflict(slot_id) do update set tenant=excluded.tenant, template_id=excluded.template_id,
              primary_keyword=excluded.primary_keyword, region=excluded.region, persona=excluded.persona,
              intent=excluded.intent, modifier_1=excluded.modifier_1, modifier_2=excluded.modifier_2,
              entity_id=excluded.entity_id, priority_score=excluded.priority_score, status='planned', last_error=null''',
            (new_id, DST, slot['template_id'], slot['primary_keyword'], slot['region'], slot['persona'], slot['intent'], slot['modifier_1'], slot['modifier_2'], slot['entity_id'], slot['priority_score']))
        created.append(new_id)
    job_id = None
    if created:
        job_id = str(uuid.uuid4())
        payload = {
            'slot_ids': created,
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
    print(json.dumps({
        'tenant': DST,
        'created_slots': len(created),
        'slot_ids': created,
        'queued_job_id': job_id,
        'copied_axes': con.execute('select count(*) n from axes where tenant=?', (DST,)).fetchone()['n'],
        'copied_regions': con.execute('select count(*) n from seo_regions where tenant=?', (DST,)).fetchone()['n'],
        'copied_academies': con.execute('select count(*) n from academies where tenant=?', (DST,)).fetchone()['n'],
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
