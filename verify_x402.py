#!/usr/bin/env python3
"""WORK-DONE verifier for the x402 loop. Proves each cycle actually PERFORMED its claimed work
(real artifacts: git commits, files changed, outreach/queue updates) vs. logging 'done' having done
nothing. Does NOT judge whether the product earned — that's separate. Append-only work_done_x402.db.
"""
import os,sqlite3,subprocess,datetime,glob,time
REPO=os.path.dirname(os.path.abspath(__file__))
WDB=os.path.join(os.path.expanduser("~"),".hermes/data/x402_work_done.db")
def vinit():
    c=sqlite3.connect(WDB);c.execute("CREATE TABLE IF NOT EXISTS work(ts TEXT,window TEXT,verdict TEXT,artifacts TEXT)")
    c.execute("CREATE TRIGGER IF NOT EXISTS nou BEFORE UPDATE ON work BEGIN SELECT RAISE(ABORT,'append-only');END")
    c.execute("CREATE TRIGGER IF NOT EXISTS nod BEFORE DELETE ON work BEGIN SELECT RAISE(ABORT,'append-only');END")
    c.commit();return c
def log(win,v,a):
    try:c=vinit();c.execute("INSERT INTO work VALUES(datetime('now'),?,?,?)",(win,v,str(a)[:400]));c.commit();c.close()
    except Exception as e:print("[wlog]",e)
# look at the last 24h as the window (x402 loop cycles + crons)
since=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=24)
def commits():
    try:
        out=subprocess.run(["git","-C",REPO,"log","--since",since.isoformat(),"--oneline"],capture_output=True,text=True,timeout=15).stdout.strip()
        return [l for l in out.splitlines() if l]
    except Exception as e:return []
def files():
    cutoff=since.timestamp();hits=[]
    for base in ("outreach","scripts","src"):
        for p in glob.glob(os.path.join(REPO,base,"**","*"),recursive=True):
            try:
                if os.path.isfile(p) and os.path.getmtime(p)>=cutoff: hits.append(os.path.relpath(p,REPO))
            except:pass
    return hits
cm=commits(); ft=files()
did_work=bool(cm) or bool(ft)
v="WORK-DONE" if did_work else "NOTHING (no commits/files in 24h — claimed work unbacked)"
print(f"=== x402 WORK-DONE verifier (last 24h): {v} ===")
print(f"  commits: {len(cm)}  {cm[:5]}")
print(f"  files touched: {len(ft)}  {ft[:8]}")
log("24h","PASS" if did_work else "BLOCK",{"commits":len(cm),"files":len(ft)})
