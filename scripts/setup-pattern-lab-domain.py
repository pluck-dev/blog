#!/usr/bin/env python3
from __future__ import annotations
import json, sqlite3, uuid
from pathlib import Path

DB = Path('data/admin.db')
SRC = 'drivingplus.me'
DST = 'pattern-lab.local'
DISPLAY = '패턴랩 운전면허'
SLOT_IDS = [
    'DT_T01_1e2f3eac34a8',  # local BEST/cost comparison
    'DT_T09_c28e13f4bc08',  # exam/written tips
    'DT_T14_92d538190666',  # academy profile/local access
]

def main() -> None:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute('pragma foreign_keys=on')
    src_tenant = con.execute('select * from tenants where domain=?', (SRC,)).fetchone()
    if not src_tenant:
        raise SystemExit(f'source tenant not found: {SRC}')
    con.execute('''insert or ignore into tenants
        (domain, display_name, vertical, theme, brand_color, templates_enabled, design_template_id, content_brief, daily_limit)
        values (?, ?, 'driving', 'clean', '#2563eb', ?, 'comparison', ?, 5)''',
        (DST, DISPLAY, src_tenant['templates_enabled'], '원본 전체 글 패턴 기반 생성 테스트용 도메인. 기존 운영 도메인과 분리해 소량 검증한다.'))
    # Keep tenant metadata deterministic on rerun.
    con.execute('update tenants set display_name=?, vertical="driving", design_template_id="comparison", daily_limit=5, content_brief=? where domain=?',
                (DISPLAY, '원본 전체 글 패턴 기반 생성 테스트용 도메인. 기존 운영 도메인과 분리해 소량 검증한다.', DST))

    con.execute('delete from axes where tenant=?', (DST,))
    con.execute('''insert into axes (tenant, axis, value, weight, monthly_search_volume, competition_kd)
                   select ?, axis, value, weight, monthly_search_volume, competition_kd from axes where tenant=?''', (DST, SRC))

    # Copy source facts so generation can still use academy/region evidence while posts remain isolated.
    con.execute('delete from seo_regions where tenant=?', (DST,))
    con.execute('''insert into seo_regions (tenant, level, region, latitude, longitude, source_name, synced_at)
                   select ?, level, region, latitude, longitude, source_name, synced_at from seo_regions where tenant=?''', (DST, SRC))
    con.execute('delete from academies where tenant=?', (DST,))
    src_academies = [r for r in con.execute('select * from academies where tenant=?', (SRC,))]
    cols = [r['name'] for r in con.execute('pragma table_info(academies)')]
    insert_cols = ', '.join(cols)
    placeholders = ', '.join(['?'] * len(cols))
    for row in src_academies:
        vals = []
        for col in cols:
            if col == 'id': vals.append(str(uuid.uuid4()))
            elif col == 'tenant': vals.append(DST)
            else: vals.append(row[col])
        con.execute(f'insert into academies ({insert_cols}) values ({placeholders})', vals)

    created_slots = []
    for src_id in SLOT_IDS:
        slot = con.execute('select * from slots where slot_id=? and tenant=?', (src_id, SRC)).fetchone()
        if not slot:
            print('missing source slot', src_id)
            continue
        new_id = 'PL_' + src_id
        con.execute('''insert into slots
            (slot_id, tenant, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score, status, last_error)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', null)
            on conflict(slot_id) do update set tenant=excluded.tenant, template_id=excluded.template_id,
              primary_keyword=excluded.primary_keyword, region=excluded.region, persona=excluded.persona,
              intent=excluded.intent, modifier_1=excluded.modifier_1, modifier_2=excluded.modifier_2,
              entity_id=excluded.entity_id, priority_score=excluded.priority_score, status='planned', last_error=null''',
            (new_id, DST, slot['template_id'], slot['primary_keyword'], slot['region'], slot['persona'], slot['intent'], slot['modifier_1'], slot['modifier_2'], slot['entity_id'], slot['priority_score']))
        created_slots.append(new_id)

    # Avoid duplicate active jobs for the same test run.
    active = con.execute('select count(*) n from jobs where tenant=? and status in ("queued","running")', (DST,)).fetchone()['n']
    job_id = None
    if created_slots and not active:
        job_id = str(uuid.uuid4())
        payload = {
            'slot_ids': created_slots,
            'provider': 'codex',
            'model': '',
            'design_template_id': 'comparison',
            'cooldown_sec': 10,
            'timeout_sec': 900,
            'max_repair_attempts': 3,
            'pattern_based': True,
        }
        con.execute('insert into jobs (id, tenant, kind, payload, status) values (?, ?, "generate", ?, "queued")', (job_id, DST, json.dumps(payload, ensure_ascii=False)))
    con.commit()
    print(json.dumps({
        'tenant': DST,
        'copied_axes': con.execute('select count(*) n from axes where tenant=?', (DST,)).fetchone()['n'],
        'copied_regions': con.execute('select count(*) n from seo_regions where tenant=?', (DST,)).fetchone()['n'],
        'copied_academies': con.execute('select count(*) n from academies where tenant=?', (DST,)).fetchone()['n'],
        'slot_ids': created_slots,
        'queued_job_id': job_id,
        'active_job_skipped': bool(active),
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
