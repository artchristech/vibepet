#!/usr/bin/env python3
"""Redacted schema learner (mineB). Prints ONLY key paths (dynamic keys redacted to <key>),
value type counts, and enum value counts for allowed enum keys. Never prints string values."""
import os, sys, json, re, collections, glob
ROOT=os.path.expanduser('~/.claude/projects')
ENUM={'toolDenialKind','kind','promptSource','turnOrigin','mode','speed','name','type','subtype','role','stop_reason','model','permissionMode','version','operation','userType','is_error','isSidechain','isMeta','interrupted','status','level'}
IDENT=re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,40}$')
paths=collections.Counter(); types=collections.defaultdict(collections.Counter); enums=collections.defaultdict(collections.Counter)
MAXDEPTH=int(os.environ.get('DEPTH','3'))
def walk(v,p,d):
    if isinstance(v,dict):
        if d>=MAXDEPTH: paths[p]+=1; types[p]['dict']+=1; return
        for k,x in v.items():
            k2=k if IDENT.match(k) else '<key>'
            walk(x,(p+'.'+k2) if p else k2,d+1)
    elif isinstance(v,list):
        if d>=MAXDEPTH: paths[p]+=1; types[p]['list']+=1; return
        for x in v[:20]: walk(x,p+'[]',d+1)
    else:
        paths[p]+=1; types[p][type(v).__name__]+=1
        last=p.split('.')[-1].replace('[]','')
        if last in ENUM:
            if isinstance(v,str) and not re.match(r'^[A-Za-z0-9_.:\-\[\]]{1,40}$',v): enums[p]['<redacted>']+=1
            else: enums[p][str(v)]+=1
files=[]
for dn in os.listdir(ROOT):
    if any(s in dn for s in ('private-tmp','scratchpad','-vibepet-ultra-fleet-')): continue
    files+=glob.glob(os.path.join(ROOT,dn,'*.jsonl'))
files.sort(key=os.path.getmtime)
step=max(1,len(files)//int(sys.argv[1] if len(sys.argv)>1 else 60))
prefix=tuple(sys.argv[2].split(',')) if len(sys.argv)>2 else ('',)
for f in files[::step]:
    with open(f,'rb') as fh:
        for i,line in enumerate(fh):
            if i>3000: break
            try: r=json.loads(line)
            except Exception: continue
            walk(r,'',0)
for p,c in sorted(paths.items()):
    if c<3 or not p.startswith(prefix): continue
    e=dict(enums[p].most_common(20)) if p in enums else ''
    print(c,p,dict(types[p]),e)
