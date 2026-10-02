# python3 prefork.py PORT "Title" [workers]: master binds 127.0.0.1:PORT, forks workers that accept (gunicorn shape); respawns a dead worker
import os, sys, socket, signal, time
port, title = int(sys.argv[1]), sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen(64)
print('LISTENING %d' % int(time.time() * 1000), flush=True)
def work():
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    while True:
        c, _ = s.accept()
        try:
            c.recv(4096); body = ('<title>%s</title>worker %d' % (title, os.getpid())).encode()
            c.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %d\r\nConnection: close\r\n\r\n' % len(body) + body)
        finally: c.close()
kids = set()
def spawn():
    pid = os.fork()
    if pid == 0: work(); os._exit(0)
    kids.add(pid)
for _ in range(n): spawn()
def term(*a):
    for k in list(kids):
        try: os.kill(k, signal.SIGTERM)
        except OSError: pass
    os._exit(0)
signal.signal(signal.SIGTERM, term); signal.signal(signal.SIGINT, term)
while True:
    try: pid, _ = os.wait()
    except ChildProcessError: time.sleep(0.1); continue
    if pid in kids:
        kids.discard(pid); print('RESPAWN after %d at %d' % (pid, int(time.time() * 1000)), flush=True); spawn()
